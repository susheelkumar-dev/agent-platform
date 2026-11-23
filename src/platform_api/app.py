"""Application factory.

Standalone::

    uvicorn platform_api.main:app

Embedded in an existing FastAPI application::

    from platform_api import create_app
    existing_app.mount("/ai", create_app(settings, local_agents=[MyAgent()]))
"""

from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from ai_agents.base import BaseAgent
from ai_core import __version__
from ai_core.config import Settings, get_settings
from ai_core.errors import PlatformError, RateLimitError
from ai_core.models import new_id
from ai_observability.logging import configure_logging, request_id_var
from ai_observability.tracing import configure_tracing
from ai_security.policy import PolicyEngine
from platform_api.container import PlatformContainer
from platform_api.routers import agent_services, agents, chat, conversations, documents, executions, system

logger = logging.getLogger("platform_api")
STATIC_DIR = Path(__file__).parent / "static"


def create_app(
    settings: Settings | None = None,
    *,
    local_agents: Sequence[BaseAgent] = (),
    agent_transport: httpx.AsyncBaseTransport | None = None,
    llm_transport: httpx.AsyncBaseTransport | None = None,
    policy_engine: PolicyEngine | None = None,
    configure_logs: bool = True,
) -> FastAPI:
    settings = settings or get_settings()
    if configure_logs:
        configure_logging(settings.log_level, settings.log_format)
    configure_tracing(settings.otel_enabled, settings.otel_service_name)
    container = PlatformContainer(
        settings,
        agent_transport=agent_transport,
        llm_transport=llm_transport,
        local_agents=local_agents,
        policy_engine=policy_engine,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await container.startup()
        try:
            yield
        finally:
            await container.shutdown()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=(
            "Drop-in agentic AI infrastructure. Agents are independent services that self-register; the "
            "platform owns discovery, routing, planning, orchestration, LLM access, RAG, security and telemetry."
        ),
        lifespan=lifespan,
    )
    app.state.container = container
    app.state.settings = settings

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
            allow_credentials=True,
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or new_id()
        token = request_id_var.set(rid)
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            elapsed = time.perf_counter() - start
            route = request.scope.get("route")
            path = getattr(route, "path", "unmatched")
            container.metrics.http_requests.inc(method=request.method, route=path, status=str(status))
            container.metrics.http_latency.observe(elapsed, route=path)
            if path not in ("/health", "/metrics", "/ready"):
                logger.info("http %s %s -> %s in %.0fms", request.method, request.url.path, status, elapsed * 1000)
            request_id_var.reset(token)

    @app.exception_handler(PlatformError)
    async def platform_error_handler(request: Request, exc: PlatformError):
        info = exc.to_info(request_id_var.get())
        headers = {}
        if isinstance(exc, RateLimitError):
            headers["Retry-After"] = str(int(exc.details.get("retry_after_seconds", 1)) + 1)
        if exc.http_status == 401:
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse(
            status_code=exc.http_status,
            content={"detail": exc.message, "error": info.model_dump(mode="json")},
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Request validation failed",
                "error": {"code": "REQUEST_INVALID", "category": "VALIDATION", "retryable": False,
                          "message": "Request validation failed",
                          "details": {"errors": [
                              {k: (v if k in ("type", "loc", "msg") else str(v)) for k, v in e.items()
                               if k in ("type", "loc", "msg", "input")}
                              for e in exc.errors()
                          ]}, "correlation_id": request_id_var.get()},
            },
        )

    for module in (system, chat, executions, agents, agent_services, documents, conversations):
        app.include_router(module.router)

    if settings.serve_ui:
        @app.get("/", include_in_schema=False)
        async def ui():
            return FileResponse(STATIC_DIR / "index.html")

    return app
