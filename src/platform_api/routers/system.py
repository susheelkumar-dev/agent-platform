"""Health, readiness, metrics, identity, audit and usage endpoints."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, PlainTextResponse

from ai_core import __version__
from ai_core.models import UserContext
from ai_core.models.ops import AuditEvent
from platform_api.container import PlatformContainer
from platform_api.deps import admin_user, current_user, get_container

router = APIRouter(tags=["system"])


@router.get("/health", summary="Liveness")
@router.get("/api/v1/health", include_in_schema=False)
async def health() -> dict[str, Any]:
    return {"status": "ok", "version": __version__}


@router.get("/ready", summary="Readiness (database reachable)")
async def ready(c: PlatformContainer = Depends(get_container)):
    db_ok = await c.db.ping() if c.db is not None else True
    body = {"status": "ready" if db_ok else "not-ready", "database": db_ok}
    return JSONResponse(body, status_code=200 if db_ok else 503)


@router.get("/metrics", response_class=PlainTextResponse, summary="Prometheus metrics")
async def metrics(c: PlatformContainer = Depends(get_container)) -> PlainTextResponse:
    await c.refresh_gauges()
    return PlainTextResponse(c.metrics.render(), media_type="text/plain; version=0.0.4")


@router.get("/api/v1/me", response_model=UserContext, tags=["identity"])
async def me(user: UserContext = Depends(current_user)) -> UserContext:
    return user


@router.get("/api/v1/admin/audit", response_model=list[AuditEvent], tags=["admin"])
async def audit_log(
    limit: int = 100, admin: UserContext = Depends(admin_user), c: PlatformContainer = Depends(get_container)
) -> list[AuditEvent]:
    return await c.audit_store.list(admin.tenant_id if admin.tenant_id != "*" else None, limit)


@router.get("/api/v1/admin/usage", tags=["admin"], summary="LLM token/cost usage summary for the tenant")
async def usage(
    admin: UserContext = Depends(admin_user), c: PlatformContainer = Depends(get_container)
) -> dict[str, Any]:
    records = await c.usage_store.list(admin.tenant_id, limit=10_000)
    by_model: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    by_agent: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in records:
        for bucket in (by_model[f"{r.provider}:{r.model}"], by_agent[r.agent_id or "platform"]):
            bucket["requests"] += 1
            bucket["prompt_tokens"] += r.prompt_tokens
            bucket["completion_tokens"] += r.completion_tokens
            bucket["cost_usd"] += r.cost_usd
    return {
        "tenant_id": admin.tenant_id,
        "records": len(records),
        "by_model": by_model,
        "by_agent": by_agent,
        "total_cost_usd": round(sum(r.cost_usd for r in records), 6),
    }
