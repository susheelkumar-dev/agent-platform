"""Turn any ``BaseAgent`` into an independently deployable microservice.

The generated service implements the platform's agent-service contract:

=====================  ==========================================================
``GET  /health``       liveness
``GET  /ready``        readiness (``agent.ready()``); the platform probes this
``GET  /api/v1/manifest``  versioned manifest (identity, capabilities, schemas…)
``POST /api/v1/execute``   run one step (bearer token + HMAC signature verified)
``GET  /metrics``      Prometheus metrics for the agent
=====================  ==========================================================

On startup it registers with the platform (retrying with backoff), then sends
heartbeats; if the platform forgets it (e.g. restarted with in-memory storage)
it re-registers automatically. On shutdown it deregisters so traffic stops
immediately instead of waiting for health checks.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import ValidationError as PydanticValidationError

from ai_agent_sdk.platform_client import HttpPlatformServices
from ai_agent_sdk.settings import AgentServiceSettings
from ai_agents.base import BaseAgent
from ai_core.errors import PlatformError
from ai_core.models import AgentManifest, AgentRequest, AgentResult
from ai_observability.metrics import Counter, Histogram
from ai_security.signing import SIGNATURE_HEADER, SignatureError, verify_request

logger = logging.getLogger("ai_agent_sdk")


class _IdempotencyCache:
    def __init__(self, size: int, ttl_seconds: float = 900) -> None:
        self.size = size
        self.ttl = ttl_seconds
        self._items: OrderedDict[str, tuple[float, dict]] = OrderedDict()

    def get(self, key: str | None) -> dict | None:
        if not key or key not in self._items:
            return None
        ts, value = self._items[key]
        if time.monotonic() - ts > self.ttl:
            del self._items[key]
            return None
        return value

    def put(self, key: str | None, value: dict) -> None:
        if not key or self.size <= 0:
            return
        self._items[key] = (time.monotonic(), value)
        self._items.move_to_end(key)
        while len(self._items) > self.size:
            self._items.popitem(last=False)


def create_agent_app(
    agent: BaseAgent,
    *,
    service_url: str | None = None,
    platform_url: str | None = None,
    settings: AgentServiceSettings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    configure_logs: bool = False,
    on_registered: Callable[[dict], None] | None = None,
) -> FastAPI:
    settings = settings or AgentServiceSettings()
    if platform_url:
        settings.platform_url = platform_url
    if service_url:
        settings.service_url = service_url
    if configure_logs:
        from ai_observability.logging import configure_logging

        configure_logging(settings.log_level, settings.log_format)

    manifest: AgentManifest = agent.manifest()
    if settings.max_concurrency:
        manifest.max_concurrency = settings.max_concurrency
    platform_url = settings.platform_url.rstrip("/")
    limit = manifest.max_concurrency
    semaphore = asyncio.Semaphore(limit) if limit else None
    cache = _IdempotencyCache(settings.idempotency_cache_size if manifest.idempotent else 0)
    requests_total = Counter("agent_requests_total", "Execute requests by outcome")
    latency = Histogram("agent_request_duration_seconds", "Execute latency")
    state: dict = {"registered": False, "last_error": None}

    async def register(client: httpx.AsyncClient) -> dict:
        if not settings.service_url:
            raise RuntimeError("AGENT_SERVICE_URL is not set; the platform cannot reach this agent")
        response = await client.post(
            f"{platform_url}/api/v1/agent-services/register",
            json={"manifest": manifest.model_dump(mode="json"), "service_url": settings.service_url},
            headers={"Authorization": f"Bearer {settings.registration_token}"},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    async def heartbeat(client: httpx.AsyncClient) -> int:
        healthy = await agent.ready()
        response = await client.post(
            f"{platform_url}/api/v1/agent-services/heartbeat",
            json={"agent_id": manifest.agent_id, "version": manifest.version,
                  "health": "healthy" if healthy else "degraded"},
            headers={"Authorization": f"Bearer {settings.registration_token}"},
            timeout=10,
        )
        return response.status_code

    async def connection_loop(client: httpx.AsyncClient) -> None:
        backoff = 1.0
        interval = settings.heartbeat_interval_seconds
        while True:
            try:
                if not state["registered"]:
                    info = await register(client)
                    state["registered"] = True
                    state["last_error"] = None
                    interval = min(settings.heartbeat_interval_seconds,
                                   float(info.get("heartbeat_interval_seconds", interval)))
                    backoff = 1.0
                    logger.info("registered agent %s@%s with %s", manifest.agent_id, manifest.version, platform_url)
                    if on_registered:
                        on_registered(info)
                else:
                    status = await heartbeat(client)
                    if status == 404:
                        logger.warning("platform does not know this agent anymore; re-registering")
                        state["registered"] = False
                        continue
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                state["registered"] = False
                state["last_error"] = f"{type(exc).__name__}: {exc}"
                logger.warning("platform connection failed (%s); retrying in %.0fs", state["last_error"], backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = httpx.AsyncClient(transport=transport, timeout=30)
        app.state.platform_client = client
        if agent.platform is None:
            agent.platform = HttpPlatformServices(platform_url, settings.registration_token, manifest.agent_id, client)
        await agent.startup()
        task = asyncio.create_task(connection_loop(client)) if settings.auto_register else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                if state["registered"]:
                    with contextlib.suppress(Exception):
                        await client.post(
                            f"{platform_url}/api/v1/agent-services/deregister",
                            json={"agent_id": manifest.agent_id, "version": manifest.version},
                            headers={"Authorization": f"Bearer {settings.registration_token}"},
                            timeout=3,
                        )
            await agent.shutdown()
            await client.aclose()

    app = FastAPI(
        title=f"{manifest.name} — agent service",
        version=manifest.version,
        description=manifest.description,
        lifespan=lifespan,
    )
    app.state.agent = agent
    app.state.manifest = manifest
    app.state.connection = state

    @app.get("/health", tags=["agent"])
    async def health() -> dict:
        return {"status": "ok", "agent_id": manifest.agent_id, "version": manifest.version}

    @app.get("/ready", tags=["agent"])
    async def ready():
        ok = await agent.ready()
        body = {"status": "ready" if ok else "not-ready", "agent_id": manifest.agent_id,
                "registered": state["registered"], "platform_error": state["last_error"]}
        return JSONResponse(body, status_code=200 if ok else 503)

    @app.get("/api/v1/manifest", response_model=AgentManifest, tags=["agent"])
    async def get_manifest() -> AgentManifest:
        return manifest

    @app.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
    async def metrics() -> PlainTextResponse:
        lines = [*requests_total.render(), *latency.render()]
        return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")

    def error(status: int, code: str, message: str, **details) -> JSONResponse:
        return JSONResponse(
            status_code=status,
            content={"detail": message, "error": {"code": code, "message": message, "details": details}},
        )

    @app.post("/api/v1/execute", response_model=AgentResult, tags=["agent"])
    async def execute(request: Request):
        auth = request.headers.get("Authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else ""
        if not token or not hmac.compare_digest(token, settings.service_token):
            requests_total.inc(outcome="unauthorized")
            return error(401, "UNAUTHORIZED", "Invalid platform service token")
        body = await request.body()
        signature = request.headers.get(SIGNATURE_HEADER)
        if settings.signing_secret and (settings.require_signature or signature):
            try:
                verify_request(settings.signing_secret, body, signature)
            except SignatureError as exc:
                requests_total.inc(outcome="bad_signature")
                return error(401, "BAD_SIGNATURE", f"Request signature rejected: {exc}")
        try:
            agent_request = AgentRequest.model_validate_json(body)
        except PydanticValidationError as exc:
            return error(422, "INVALID_REQUEST", "Malformed AgentRequest",
                         errors=exc.errors(include_url=False, include_context=False, include_input=False))
        if agent_request.agent_id != manifest.agent_id:
            return error(400, "WRONG_AGENT", f"This service hosts '{manifest.agent_id}'")
        if agent_request.capability and agent_request.capability not in manifest.capability_names:
            return error(400, "UNSUPPORTED_CAPABILITY", f"'{agent_request.capability}' is not implemented here")

        cached = cache.get(agent_request.idempotency_key)
        if cached is not None:
            requests_total.inc(outcome="idempotent_replay")
            return JSONResponse(cached)

        model = agent.input_model_for(agent_request.capability or manifest.capability_names[0])
        if model is not None:
            try:
                validated = model.model_validate(agent_request.input)
                agent_request.input = validated.model_dump(mode="json")
            except PydanticValidationError as exc:
                return error(422, "INPUT_INVALID", "Input does not match the capability schema",
                             errors=exc.errors(include_url=False, include_context=False, include_input=False))

        if semaphore is not None and semaphore.locked():
            requests_total.inc(outcome="busy")
            return error(429, "AT_CAPACITY", "Agent is at max concurrency")

        context = agent_request.context
        if agent_request.context_token:
            context.metadata["platform_context_token"] = agent_request.context_token
        timeout = agent_request.deadline_seconds or manifest.timeout_seconds
        start = time.perf_counter()
        outcome = "error"
        try:
            async with semaphore if semaphore is not None else contextlib.nullcontext():
                async with asyncio.timeout(timeout):
                    result = await agent.execute(agent_request, context)
            outcome = result.status
        except TimeoutError:
            result = AgentResult.failure(f"Agent exceeded its {timeout}s deadline", code="AGENT_TIMEOUT",
                                         retryable=True, category="TIMEOUT")
        except PlatformError as exc:
            result = AgentResult.failure(exc.message, code=exc.code, retryable=exc.retryable,
                                         category=str(exc.category), details=exc.details)
        except Exception as exc:
            logger.exception("agent %s failed", manifest.agent_id)
            result = AgentResult.failure(f"{type(exc).__name__}: {exc}", code="AGENT_EXCEPTION")
        finally:
            latency.observe(time.perf_counter() - start)
            requests_total.inc(outcome=outcome)
        result.metadata.setdefault("agent_id", manifest.agent_id)
        result.metadata.setdefault("agent_version", manifest.version)
        payload = result.model_dump(mode="json")
        if result.status == "success":
            cache.put(agent_request.idempotency_key, payload)
        return JSONResponse(payload)

    return app


def run_agent(agent: BaseAgent, *, host: str = "0.0.0.0", port: int = 8080, **kwargs) -> None:
    """Run an agent service with uvicorn (``python main.py``)."""
    import os

    import uvicorn

    settings = kwargs.pop("settings", None) or AgentServiceSettings()
    if not settings.service_url:
        public_host = os.getenv("AGENT_PUBLIC_HOST", "127.0.0.1" if host in ("0.0.0.0", "127.0.0.1") else host)
        settings.service_url = f"http://{public_host}:{port}"
    app = create_agent_app(agent, settings=settings, configure_logs=True, **kwargs)
    uvicorn.run(app, host=host, port=port, log_config=None)
