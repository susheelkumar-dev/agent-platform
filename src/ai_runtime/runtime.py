"""Agent Runtime: the standardized invocation boundary (LLD §14, Gap G06).

``AgentRuntimeDispatcher`` selects the concrete transport from authoritative
registry metadata. The orchestrator only ever sees ``AgentRuntime.invoke``.
"""

from __future__ import annotations

import json
import logging
import time

import httpx

from ai_agents.base import BaseAgent, PlatformServices
from ai_core.errors import (
    AgentUnavailableError,
    ErrorCategory,
    PlatformError,
    RateLimitError,
    StepTimeoutError,
    ValidationError,
)
from ai_core.models import AgentRecord, AgentRequest, AgentResult, RuntimeType
from ai_observability.tracing import inject_headers
from ai_security.signing import SIGNATURE_HEADER, sign_request

logger = logging.getLogger("ai_runtime")


class LocalAgentRuntime:
    """Runs agents inside the platform process.

    Used for built-in platform agents (aggregation, charts, document Q&A) and
    for organizations that embed the platform as a library and prefer
    in-process agents for some capabilities.
    """

    def __init__(self, services: PlatformServices | None = None) -> None:
        self._agents: dict[str, BaseAgent] = {}
        self.services = services
        self._started: set[str] = set()

    def register(self, agent: BaseAgent) -> None:
        if self.services is not None and agent.platform is None:
            agent.platform = self.services
        self._agents[agent.id] = agent

    def unregister(self, agent_id: str) -> None:
        self._agents.pop(agent_id, None)

    @property
    def agents(self) -> list[BaseAgent]:
        return list(self._agents.values())

    async def startup(self) -> None:
        for agent in self._agents.values():
            if agent.id not in self._started:
                await agent.startup()
                self._started.add(agent.id)

    async def shutdown(self) -> None:
        for agent in self._agents.values():
            try:
                await agent.shutdown()
            except Exception:
                logger.exception("agent shutdown failed: %s", agent.id)

    async def invoke(self, request: AgentRequest, target: AgentRecord) -> AgentResult:
        agent = self._agents.get(target.agent_id)
        if agent is None:
            raise AgentUnavailableError(
                f"Local agent '{target.agent_id}' is not loaded in this process", retryable=False
            )
        if request.context_token:
            request.context.metadata.setdefault("platform_context_token", request.context_token)
        try:
            return await agent.execute(request, request.context)
        except PlatformError:
            raise
        except Exception as exc:
            logger.exception("local agent %s failed", target.agent_id)
            raise PlatformError(
                f"Agent '{target.agent_id}' raised {type(exc).__name__}: {exc}",
                code="AGENT_EXCEPTION",
                category=ErrorCategory.EXECUTION,
            ) from exc


class CircuitBreaker:
    """Per-endpoint breaker: open after N consecutive failures, half-open after a cool-down."""

    def __init__(self, failure_threshold: int, reset_seconds: float) -> None:
        self.failure_threshold = failure_threshold
        self.reset_seconds = reset_seconds
        self._failures: dict[str, int] = {}
        self._opened_at: dict[str, float] = {}

    def before_call(self, key: str) -> None:
        opened = self._opened_at.get(key)
        if opened is None:
            return
        if time.monotonic() - opened < self.reset_seconds:
            raise AgentUnavailableError(
                f"Circuit open for {key}; failing fast", code="CIRCUIT_OPEN", details={"endpoint": key}
            )
        # half-open: allow one trial call
        del self._opened_at[key]

    def record_success(self, key: str) -> None:
        self._failures.pop(key, None)
        self._opened_at.pop(key, None)

    def record_failure(self, key: str) -> None:
        count = self._failures.get(key, 0) + 1
        self._failures[key] = count
        if count >= self.failure_threshold:
            self._opened_at[key] = time.monotonic()
            logger.warning("circuit_opened endpoint=%s failures=%s", key, count)

    def state(self, key: str) -> str:
        return "open" if key in self._opened_at else "closed"


class RemoteHttpAgentRuntime:
    """Invokes an independently deployed agent service over its HTTP contract.

    Contract: ``POST {service_url}/api/v1/execute`` with an ``AgentRequest``
    body, ``Authorization: Bearer <service token>`` and an HMAC
    ``X-Platform-Signature``. Responses are ``AgentResult``.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        service_token: str,
        signing_secret: str | None,
        breaker: CircuitBreaker,
    ) -> None:
        self.client = client
        self.service_token = service_token
        self.signing_secret = signing_secret
        self.breaker = breaker

    async def invoke(self, request: AgentRequest, target: AgentRecord) -> AgentResult:
        if not target.service_url:
            raise AgentUnavailableError(f"Remote agent '{target.agent_id}' has no service URL", retryable=False)
        url = f"{target.service_url}/api/v1/execute"
        key = target.service_url
        self.breaker.before_call(key)

        body = json.dumps(request.model_dump(mode="json"), separators=(",", ":")).encode()
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.service_token}",
            "X-Request-ID": request.request_id,
            "X-Execution-ID": request.context.execution_id,
            "X-Agent-Attempt": str(request.attempt),
        }
        if request.idempotency_key:
            headers["Idempotency-Key"] = request.idempotency_key
        if self.signing_secret:
            headers[SIGNATURE_HEADER] = sign_request(self.signing_secret, body)
        inject_headers(headers)

        timeout = request.deadline_seconds or target.manifest.timeout_seconds
        try:
            response = await self.client.post(url, content=body, headers=headers, timeout=timeout + 1)
        except httpx.TimeoutException as exc:
            self.breaker.record_failure(key)
            raise StepTimeoutError(f"Agent '{target.agent_id}' timed out after {timeout}s") from exc
        except httpx.TransportError as exc:
            self.breaker.record_failure(key)
            raise AgentUnavailableError(
                f"Agent '{target.agent_id}' unreachable at {target.service_url}: {type(exc).__name__}"
            ) from exc

        status = response.status_code
        if status >= 500 or status in (502, 503, 504):
            self.breaker.record_failure(key)
            raise AgentUnavailableError(
                f"Agent '{target.agent_id}' returned HTTP {status}", details={"body": response.text[:500]}
            )
        self.breaker.record_success(key)
        if status == 429:
            raise RateLimitError(f"Agent '{target.agent_id}' is at capacity (HTTP 429)")
        if status in (401, 403):
            raise AgentUnavailableError(
                f"Agent '{target.agent_id}' rejected platform credentials (HTTP {status})",
                code="AGENT_AUTH_FAILED",
                retryable=False,
            )
        if status == 422 or status == 400:
            raise ValidationError(
                f"Agent '{target.agent_id}' rejected the input (HTTP {status})",
                details={"body": response.text[:1000]},
            )
        if status >= 400:
            raise PlatformError(
                f"Agent '{target.agent_id}' returned HTTP {status}",
                code="AGENT_HTTP_ERROR",
                details={"body": response.text[:500]},
            )
        try:
            return AgentResult.model_validate(response.json())
        except Exception as exc:
            raise PlatformError(
                f"Agent '{target.agent_id}' returned an invalid AgentResult: {exc}", code="AGENT_BAD_RESPONSE"
            ) from exc


class AgentRuntimeDispatcher:
    def __init__(self, local: LocalAgentRuntime, remote: RemoteHttpAgentRuntime, *, metrics=None) -> None:
        self.local = local
        self.remote = remote
        self.metrics = metrics

    async def invoke(self, request: AgentRequest, target: AgentRecord) -> AgentResult:
        runtime = self.local if target.runtime_type == RuntimeType.LOCAL else self.remote
        outcome = "error"
        try:
            result = await runtime.invoke(request, target)
            outcome = result.status
            return result
        finally:
            if self.metrics is not None:
                self.metrics.agent_calls.inc(agent=target.agent_id, version=target.version, outcome=outcome)
