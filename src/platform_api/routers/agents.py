"""Agent registry API: service registration/heartbeat (agents) and catalog/admin (users)."""

from __future__ import annotations

import fnmatch
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Query, Security
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from ai_core.errors import AuthorizationError, NotFoundError, ValidationError
from ai_core.models import AgentHeartbeat, AgentRegistration, AgentStatusUpdate, UserContext
from platform_api.container import PlatformContainer
from platform_api.deps import admin_user, bearer, check_registration_token, current_user, get_container

router = APIRouter(prefix="/api/v1", tags=["agents"])


class Deregistration(BaseModel):
    agent_id: str
    version: str
    registration_token: str | None = None


def _token(body_token: str | None, credentials: HTTPAuthorizationCredentials | None) -> str | None:
    return body_token or (credentials.credentials if credentials else None)


# ---- agent-facing ------------------------------------------------------------------------
@router.post("/agent-services/register", tags=["agent-services"], summary="Register or refresh an agent service")
async def register_agent_service(
    registration: AgentRegistration,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
    c: PlatformContainer = Depends(get_container),
) -> dict[str, Any]:
    manifest = registration.manifest
    check_registration_token(c, _token(registration.registration_token, credentials), manifest.agent_id)
    parsed = urlparse(registration.service_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValidationError("service_url must be an absolute http(s) URL", code="INVALID_SERVICE_URL")
    if not any(fnmatch.fnmatch(parsed.hostname, pattern) for pattern in c.settings.allowed_agent_hosts):
        raise AuthorizationError(f"Agent host '{parsed.hostname}' is not allowed", code="HOST_NOT_ALLOWED")
    if manifest.agent_id.startswith("platform-"):
        raise AuthorizationError("The 'platform-' agent id prefix is reserved", code="RESERVED_AGENT_ID")
    platform_caps = [c_ for c_ in manifest.capability_names if c_.startswith("platform.")]
    if platform_caps:
        raise AuthorizationError(f"Capabilities {platform_caps} are reserved for the platform",
                                 code="RESERVED_CAPABILITY")
    record = await c.registry.register(manifest, service_url=registration.service_url)
    return {
        "status": "registered",
        "agent_id": record.agent_id,
        "version": record.version,
        "agent_status": record.status,
        "capabilities": manifest.capability_names,
        "heartbeat_interval_seconds": max(5.0, c.settings.heartbeat_ttl_seconds / 3),
    }


@router.post("/agent-services/heartbeat", tags=["agent-services"])
async def heartbeat(
    beat: AgentHeartbeat,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
    c: PlatformContainer = Depends(get_container),
) -> dict[str, Any]:
    check_registration_token(c, _token(beat.registration_token, credentials), beat.agent_id)
    record = await c.registry.heartbeat(beat.agent_id, beat.version, health=beat.health, detail=beat.detail)
    return {"status": "ok", "agent_status": record.status, "health": record.health}


@router.post("/agent-services/deregister", tags=["agent-services"])
async def deregister(
    body: Deregistration,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
    c: PlatformContainer = Depends(get_container),
) -> dict[str, Any]:
    check_registration_token(c, _token(body.registration_token, credentials), body.agent_id)
    record = await c.registry.deregister(body.agent_id, body.version)
    return {"status": "offline", "agent_id": record.agent_id, "version": record.version}


# ---- catalog (users) -------------------------------------------------------------------------
@router.get("/agents", summary="List agents visible to the caller's tenant")
async def list_agents(
    user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> list[dict[str, Any]]:
    tenant = None if user.is_admin else user.tenant_id
    return [r.public_view() for r in await c.registry.list_agents(tenant)]


@router.get("/agents/{agent_id}", summary="All registered versions of an agent")
async def get_agent(
    agent_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> list[dict[str, Any]]:
    versions = [r for r in await c.registry.list_agents(None if user.is_admin else user.tenant_id)
                if r.agent_id == agent_id]
    if not versions:
        raise NotFoundError(f"Agent '{agent_id}' not found")
    return [r.public_view() for r in versions]


@router.get("/capabilities")
async def list_capabilities(
    include_internal: bool = False,
    user: UserContext = Depends(current_user),
    c: PlatformContainer = Depends(get_container),
) -> list[dict[str, Any]]:
    return [i.model_dump() for i in await c.registry.catalog(user.tenant_id, include_internal=include_internal)]


@router.get("/capabilities/{name}/agents")
async def capability_agents(
    name: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> list[dict[str, Any]]:
    records = await c.registry.find_candidates(name, tenant_id=user.tenant_id, routable_only=False)
    return [r.public_view() for r in records]


# ---- administration ----------------------------------------------------------------------------
@router.patch("/agents/{agent_id}/status", tags=["admin"], summary="Enable / disable / deprecate / retire")
async def set_agent_status(
    agent_id: str,
    update: AgentStatusUpdate,
    version: str | None = Query(default=None, description="Omit to apply to all versions"),
    admin: UserContext = Depends(admin_user),
    c: PlatformContainer = Depends(get_container),
) -> list[dict[str, Any]]:
    records = await c.registry.set_status(agent_id, update.status, version=version, actor=admin.user_id,
                                          reason=update.reason)
    return [r.public_view() for r in records]


@router.delete("/agents/{agent_id}", tags=["admin"])
async def delete_agent(
    agent_id: str,
    version: str | None = None,
    _admin: UserContext = Depends(admin_user),
    c: PlatformContainer = Depends(get_container),
) -> dict[str, Any]:
    if agent_id.startswith("platform-"):
        raise AuthorizationError("Built-in platform agents cannot be deleted", code="RESERVED_AGENT_ID")
    deleted = await c.registry.delete(agent_id, version)
    return {"deleted": deleted}


@router.post("/agents/health-check", tags=["admin"], summary="Probe every remote agent now")
async def run_health_check(
    _admin: UserContext = Depends(admin_user), c: PlatformContainer = Depends(get_container)
) -> list[dict[str, Any]]:
    return [r.public_view() for r in await c.health_monitor.check_all()]
