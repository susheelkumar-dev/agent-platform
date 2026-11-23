"""Agent Registry: the authoritative catalog (Arch §4.1, LLD §6).

Business rules live here; storage lives behind ``AgentRepository``. The
registry never imports or constructs application agent code: it holds
manifests, endpoints and operational state only.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from ai_core.errors import NotFoundError, RegistryError, RoutingError
from ai_core.events import EventBus, EventType, PlatformEvent
from ai_core.interfaces import AgentRepository
from ai_core.models import (
    AgentManifest,
    AgentRecord,
    AgentStatus,
    CapabilityInfo,
    HealthStatus,
    RuntimeType,
    semver_key,
    utcnow,
)
from ai_core.models.agents import STICKY_ADMIN_STATUSES

logger = logging.getLogger("ai_agents.registry")

_HEALTH_RANK = {HealthStatus.HEALTHY: 0, HealthStatus.UNKNOWN: 1, HealthStatus.DEGRADED: 2}


def selection_key(record: AgentRecord) -> tuple:
    """Lower sorts first: healthiest, then highest priority, then newest version."""
    major, minor, patch, pre = semver_key(record.version)
    return (_HEALTH_RANK.get(record.health, 9), -record.manifest.priority, -major, -minor, -patch, -pre)


class AgentRegistry:
    def __init__(
        self,
        repository: AgentRepository,
        *,
        bus: EventBus | None = None,
        cache_ttl_seconds: float = 2.0,
    ) -> None:
        self.repository = repository
        self.bus = bus
        self._cache: list[AgentRecord] | None = None
        self._cache_at = 0.0
        self._ttl = cache_ttl_seconds
        self._lock = asyncio.Lock()

    # ---- cache ---------------------------------------------------------------------
    def invalidate(self) -> None:
        self._cache = None

    async def _all(self) -> list[AgentRecord]:
        now = time.monotonic()
        if self._cache is None or now - self._cache_at > self._ttl:
            self._cache = await self.repository.list_all()
            self._cache_at = now
        return self._cache

    async def _emit(self, event_type: str, record: AgentRecord, **payload: Any) -> None:
        if self.bus is None:
            return
        await self.bus.publish(
            PlatformEvent(
                event_type=event_type,
                actor=payload.pop("actor", None),
                payload={
                    "agent_id": record.agent_id,
                    "version": record.version,
                    "status": record.status,
                    "health": record.health,
                    "service_url": record.service_url,
                    **payload,
                },
            )
        )

    # ---- registration -------------------------------------------------------------
    async def register(
        self,
        manifest: AgentManifest,
        *,
        service_url: str | None = None,
        runtime_type: RuntimeType = RuntimeType.REMOTE_HTTP,
    ) -> AgentRecord:
        if runtime_type == RuntimeType.REMOTE_HTTP and not (service_url or "").strip():
            raise RegistryError("Remote agents must provide a service_url", code="SERVICE_URL_REQUIRED")
        async with self._lock:
            existing = await self.repository.get(manifest.agent_id, manifest.version)
            now = utcnow()
            if existing is not None:
                status = existing.status if existing.status in STICKY_ADMIN_STATUSES else AgentStatus.ACTIVE
                record = existing.model_copy(
                    update={
                        "manifest": manifest,
                        "runtime_type": runtime_type,
                        "service_url": service_url.rstrip("/") if service_url else None,
                        "status": status,
                        "health": HealthStatus.HEALTHY,
                        "health_detail": None,
                        "consecutive_failures": 0,
                        "updated_at": now,
                        "last_seen_at": now,
                    }
                )
                is_new = False
            else:
                record = AgentRecord(
                    manifest=manifest,
                    runtime_type=runtime_type,
                    service_url=service_url.rstrip("/") if service_url else None,
                    status=AgentStatus.ACTIVE,
                    health=HealthStatus.HEALTHY,
                    registered_at=now,
                    updated_at=now,
                    last_seen_at=now,
                )
                is_new = True
            await self.repository.save(record)
            self.invalidate()
        if is_new or existing is None or existing.health != HealthStatus.HEALTHY:
            await self._emit(EventType.AGENT_REGISTERED, record, new=is_new)
            logger.info(
                "agent_registered agent_id=%s version=%s runtime=%s url=%s capabilities=%s",
                record.agent_id,
                record.version,
                record.runtime_type,
                record.service_url,
                manifest.capability_names,
            )
        return record

    async def heartbeat(
        self,
        agent_id: str,
        version: str,
        *,
        health: HealthStatus = HealthStatus.HEALTHY,
        detail: str | None = None,
    ) -> AgentRecord:
        record = await self.repository.get(agent_id, version)
        if record is None:
            raise NotFoundError(f"Agent '{agent_id}@{version}' is not registered", code="AGENT_NOT_REGISTERED")
        previous = record.health
        record.health = health
        record.health_detail = detail
        record.last_seen_at = utcnow()
        record.updated_at = record.last_seen_at
        if health == HealthStatus.HEALTHY:
            record.consecutive_failures = 0
        await self.repository.save(record)
        self.invalidate()
        if previous != health:
            await self._emit(EventType.AGENT_HEALTH_CHANGED, record, previous=previous, source="heartbeat")
        return record

    async def deregister(self, agent_id: str, version: str) -> AgentRecord:
        record = await self.repository.get(agent_id, version)
        if record is None:
            raise NotFoundError(f"Agent '{agent_id}@{version}' is not registered", code="AGENT_NOT_REGISTERED")
        record.health = HealthStatus.OFFLINE
        record.health_detail = "deregistered by agent (graceful shutdown)"
        record.updated_at = utcnow()
        await self.repository.save(record)
        self.invalidate()
        await self._emit(EventType.AGENT_DEREGISTERED, record)
        return record

    async def record_health_check(
        self, record: AgentRecord, *, ok: bool, detail: str | None, unhealthy_after: int
    ) -> AgentRecord:
        current = await self.repository.get(record.agent_id, record.version)
        if current is None:
            return record
        previous = current.health
        current.last_health_check_at = utcnow()
        if ok:
            current.consecutive_failures = 0
            current.health = HealthStatus.HEALTHY
            current.health_detail = None
            current.last_seen_at = current.last_health_check_at
        else:
            current.consecutive_failures += 1
            current.health = (
                HealthStatus.UNHEALTHY
                if current.consecutive_failures >= unhealthy_after
                else HealthStatus.DEGRADED
            )
            current.health_detail = detail
        current.updated_at = current.last_health_check_at
        await self.repository.save(current)
        self.invalidate()
        if previous != current.health:
            await self._emit(
                EventType.AGENT_HEALTH_CHANGED, current, previous=previous, source="monitor", detail=detail
            )
        return current

    # ---- administration ------------------------------------------------------------
    async def set_status(
        self, agent_id: str, status: AgentStatus, *, version: str | None = None, actor: str | None = None,
        reason: str | None = None,
    ) -> list[AgentRecord]:
        records = (
            [r for r in [await self.repository.get(agent_id, version)] if r]
            if version
            else await self.repository.list_versions(agent_id)
        )
        if not records:
            raise NotFoundError(f"Agent '{agent_id}' is not registered", code="AGENT_NOT_REGISTERED")
        for record in records:
            record.status = status
            record.updated_at = utcnow()
            await self.repository.save(record)
            await self._emit(EventType.AGENT_STATUS_CHANGED, record, actor=actor, reason=reason)
        self.invalidate()
        return records

    async def delete(self, agent_id: str, version: str | None = None) -> int:
        count = await self.repository.delete(agent_id, version)
        self.invalidate()
        if not count:
            raise NotFoundError(f"Agent '{agent_id}' is not registered", code="AGENT_NOT_REGISTERED")
        return count

    # ---- queries ---------------------------------------------------------------------
    async def list_agents(self, tenant_id: str | None = None) -> list[AgentRecord]:
        records = await self._all()
        if tenant_id is not None:
            records = [r for r in records if r.manifest.allows_tenant(tenant_id)]
        return sorted(records, key=lambda r: (r.agent_id, semver_key(r.version)))

    async def get(self, agent_id: str, version: str | None = None) -> AgentRecord:
        if version:
            record = await self.repository.get(agent_id, version)
            if record is None:
                raise NotFoundError(f"Agent '{agent_id}@{version}' is not registered", code="AGENT_NOT_REGISTERED")
            return record
        versions = await self.repository.list_versions(agent_id)
        if not versions:
            raise NotFoundError(f"Agent '{agent_id}' is not registered", code="AGENT_NOT_REGISTERED")
        routable = [r for r in versions if r.routable]
        return sorted(routable or versions, key=selection_key)[0]

    async def find_candidates(
        self, capability: str, *, tenant_id: str | None = None, routable_only: bool = True
    ) -> list[AgentRecord]:
        records = [r for r in await self._all() if capability in r.manifest.capability_names]
        if tenant_id is not None:
            records = [r for r in records if r.manifest.allows_tenant(tenant_id)]
        if routable_only:
            records = [r for r in records if r.routable]
        return sorted(records, key=selection_key)

    async def select(
        self,
        capability: str,
        *,
        tenant_id: str | None = None,
        agent_id: str | None = None,
        version: str | None = None,
    ) -> AgentRecord:
        candidates = await self.find_candidates(capability, tenant_id=tenant_id)
        if agent_id:
            candidates = [c for c in candidates if c.agent_id == agent_id]
        if version:
            candidates = [c for c in candidates if c.version == version]
        if not candidates:
            known = await self.find_candidates(capability, tenant_id=tenant_id, routable_only=False)
            if known:
                states = ", ".join(f"{r.agent_id}@{r.version}={r.status}/{r.health}" for r in known)
                raise RoutingError(
                    f"No routable agent for capability '{capability}' ({states})",
                    code="NO_HEALTHY_AGENT",
                    details={"capability": capability},
                )
            raise RoutingError(
                f"No registered agent implements capability '{capability}'",
                code="UNKNOWN_CAPABILITY",
                details={"capability": capability},
            )
        return candidates[0]

    async def catalog(self, tenant_id: str | None = None, *, include_internal: bool = True) -> list[CapabilityInfo]:
        by_name: dict[str, CapabilityInfo] = {}
        for record in await self.list_agents(tenant_id):
            if record.status == AgentStatus.RETIRED:
                continue
            for spec in record.manifest.capabilities:
                if spec.internal and not include_internal:
                    continue
                info = by_name.get(spec.name)
                if info is None:
                    info = CapabilityInfo(
                        name=spec.name,
                        description=spec.description,
                        internal=spec.internal,
                    )
                    by_name[spec.name] = info
                if not info.description and spec.description:
                    info.description = spec.description
                info.keywords = sorted(set(info.keywords) | set(spec.keywords))
                info.examples = list(dict.fromkeys(info.examples + spec.examples))
                info.permissions = sorted(
                    set(info.permissions) | set(spec.permissions) | set(record.manifest.permissions)
                )
                ident = f"{record.agent_id}@{record.version}"
                if ident not in info.agents:
                    info.agents.append(ident)
                info.routable = info.routable or record.routable
        return sorted(by_name.values(), key=lambda c: c.name)
