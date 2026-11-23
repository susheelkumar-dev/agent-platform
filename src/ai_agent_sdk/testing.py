"""Testing utilities for agent teams and platform integrators.

* ``make_context`` / ``run_agent_locally`` — unit-test an agent with no HTTP.
* ``FakePlatformServices`` — canned LLM/RAG responses for agents that use them.
* ``RoutingTransport`` — route httpx calls to in-process ASGI apps by host, so a
  platform and several agent services can be wired together in one test.
* ``lifespan`` — run a FastAPI app's startup/shutdown in an async test.
* ``check_agent_service`` — contract test any running agent service (used by
  ``agentctl test``).
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

from ai_agents.base import BaseAgent
from ai_core.models import (
    AgentContext,
    AgentManifest,
    AgentRequest,
    AgentResult,
    LLMResponse,
    LLMUsage,
    RetrievedChunk,
    UserContext,
    new_id,
)
from ai_security.signing import SIGNATURE_HEADER, sign_request


def make_context(
    *,
    user_id: str = "test-user",
    tenant_id: str = "test-tenant",
    permissions: list[str] | None = None,
    **kwargs: Any,
) -> AgentContext:
    return AgentContext(
        request_id=kwargs.pop("request_id", new_id()),
        execution_id=kwargs.pop("execution_id", new_id("exec")),
        conversation_id=kwargs.pop("conversation_id", new_id()),
        user=UserContext(user_id=user_id, tenant_id=tenant_id, permissions=permissions or ["*"]),
        **kwargs,
    )


def make_request(
    agent: BaseAgent | AgentManifest, input: dict[str, Any] | None = None, *, capability: str | None = None,
    context: AgentContext | None = None, **kwargs: Any,
) -> AgentRequest:
    manifest = agent.manifest() if isinstance(agent, BaseAgent) else agent
    return AgentRequest(
        request_id=new_id(),
        agent_id=manifest.agent_id,
        agent_version=manifest.version,
        capability=capability or manifest.capability_names[0],
        step_id="s1",
        input=input or {},
        context=context or make_context(),
        **kwargs,
    )


async def run_agent_locally(agent: BaseAgent, input: dict[str, Any] | None = None, **kwargs: Any) -> AgentResult:
    request = make_request(agent, input, **kwargs)
    return await agent.execute(request, request.context)


@dataclass
class FakePlatformServices:
    llm_reply: str = "fake answer"
    chunks: list[RetrievedChunk] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def generate(self, context: AgentContext, prompt: str | None = None, **kwargs: Any) -> LLMResponse:
        self.calls.append({"type": "generate", "prompt": prompt, **kwargs})
        return LLMResponse(content=self.llm_reply, provider="fake", model="fake", usage=LLMUsage())

    async def search(self, context: AgentContext, query: str, **kwargs: Any) -> list[RetrievedChunk]:
        self.calls.append({"type": "search", "query": query, **kwargs})
        return list(self.chunks)


class RoutingTransport(httpx.AsyncBaseTransport):
    """Dispatch requests to ASGI apps by ``host[:port]``; unknown hosts fail like a dead service."""

    def __init__(self, routes: dict[str, Any] | None = None) -> None:
        self.routes: dict[str, httpx.ASGITransport] = {}
        for host, app in (routes or {}).items():
            self.add(host, app)

    def add(self, host: str, app: Any) -> None:
        self.routes[host] = httpx.ASGITransport(app=app)

    def remove(self, host: str) -> None:
        self.routes.pop(host, None)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host if request.url.port is None else f"{request.url.host}:{request.url.port}"
        transport = self.routes.get(host) or self.routes.get(request.url.host)
        if transport is None:
            raise httpx.ConnectError(f"no route to {host}", request=request)
        return await transport.handle_async_request(request)


@contextlib.asynccontextmanager
async def lifespan(app: Any) -> AsyncIterator[Any]:
    """Run a FastAPI/Starlette app's lifespan (startup + shutdown) inside a test."""
    async with app.router.lifespan_context(app):
        yield app


@dataclass
class ContractCheck:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class ContractReport:
    checks: list[ContractCheck] = field(default_factory=list)
    manifest: AgentManifest | None = None

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    def add(self, name: str, passed: bool, detail: str = "") -> None:
        self.checks.append(ContractCheck(name, passed, detail))

    def render(self) -> str:
        lines = [f"{'PASS' if c.passed else 'FAIL'}  {c.name}{(' — ' + c.detail) if c.detail else ''}"
                 for c in self.checks]
        lines.append("RESULT: " + ("all checks passed" if self.passed else "contract violations found"))
        return "\n".join(lines)


async def check_agent_service(
    client: httpx.AsyncClient,
    base_url: str,
    *,
    service_token: str,
    signing_secret: str | None,
    sample_inputs: dict[str, dict[str, Any]] | None = None,
) -> ContractReport:
    """Verify an agent service honours the platform contract (Gap G24)."""
    report = ContractReport()
    base = base_url.rstrip("/")
    try:
        r = await client.get(f"{base}/health")
        report.add("GET /health returns 200", r.status_code == 200, f"HTTP {r.status_code}")
        r = await client.get(f"{base}/ready")
        report.add("GET /ready returns 200", r.status_code == 200, f"HTTP {r.status_code}")
        r = await client.get(f"{base}/api/v1/manifest")
        manifest = AgentManifest.model_validate(r.json())
        report.manifest = manifest
        report.add("manifest is valid", True, f"{manifest.agent_id}@{manifest.version}, "
                                             f"{len(manifest.capabilities)} capability(ies)")
    except Exception as exc:
        report.add("service reachable and manifest valid", False, f"{type(exc).__name__}: {exc}")
        return report

    missing_hints = [c.name for c in manifest.capabilities if not c.internal and not (c.keywords or c.examples)]
    report.add("capabilities declare routing hints (keywords/examples)", not missing_hints,
               f"missing on: {', '.join(missing_hints)}" if missing_hints else "")

    probe = make_request(manifest, {"message": "contract test"})
    body = json.dumps(probe.model_dump(mode="json")).encode()
    r = await client.post(f"{base}/api/v1/execute", content=body, headers={"Content-Type": "application/json"})
    report.add("execute rejects unauthenticated calls", r.status_code == 401, f"HTTP {r.status_code}")

    for cap in manifest.capabilities:
        example = (sample_inputs or {}).get(cap.name) or {"message": (cap.examples or [f"test {cap.name}"])[0]}
        req = make_request(manifest, example, capability=cap.name,
                           context=make_context(permissions=["*"]), idempotency_key=new_id())
        body = json.dumps(req.model_dump(mode="json")).encode()
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {service_token}"}
        if signing_secret:
            headers[SIGNATURE_HEADER] = sign_request(signing_secret, body)
        try:
            r = await client.post(f"{base}/api/v1/execute", content=body, headers=headers, timeout=60)
            result = AgentResult.model_validate(r.json()) if r.status_code == 200 else None
            ok = result is not None and result.status in ("success", "partial")
            detail = f"HTTP {r.status_code}"
            if result is not None:
                detail += f", status={result.status}"
                if result.error:
                    detail += f", error={result.error.message}"
                if ok and not result.summary:
                    detail += " (warning: no output.summary)"
            report.add(f"execute '{cap.name}' returns a valid AgentResult", ok, detail)
        except Exception as exc:
            report.add(f"execute '{cap.name}'", False, f"{type(exc).__name__}: {exc}")
    return report
