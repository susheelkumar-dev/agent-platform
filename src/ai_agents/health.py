"""Background health monitor (Gap G04).

Periodically probes ``GET {service_url}/ready`` for every remote agent that is
administratively active. Consecutive failures move an agent HEALTHY →
DEGRADED → UNHEALTHY; unhealthy agents are excluded from routing until a probe
or heartbeat succeeds again. Agents that shut down gracefully report OFFLINE
themselves and are not probed until they re-register.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

import httpx

from ai_agents.registry import AgentRegistry
from ai_core.models import AgentRecord, AgentStatus, HealthStatus, RuntimeType

logger = logging.getLogger("ai_agents.health")


class HealthMonitor:
    def __init__(
        self,
        registry: AgentRegistry,
        client: httpx.AsyncClient,
        *,
        interval_seconds: float = 15.0,
        timeout_seconds: float = 3.0,
        unhealthy_after: int = 3,
        concurrency: int = 32,
    ) -> None:
        self.registry = registry
        self.client = client
        self.interval = interval_seconds
        self.timeout = timeout_seconds
        self.unhealthy_after = unhealthy_after
        self._sem = asyncio.Semaphore(concurrency)
        self._task: asyncio.Task | None = None

    async def probe(self, record: AgentRecord) -> AgentRecord:
        async with self._sem:
            ok, detail = False, None
            try:
                response = await self.client.get(f"{record.service_url}/ready", timeout=self.timeout)
                ok = response.status_code == 200
                if not ok:
                    detail = f"/ready returned HTTP {response.status_code}"
            except httpx.HTTPError as exc:
                detail = f"{type(exc).__name__}: {exc}"[:500]
            return await self.registry.record_health_check(
                record, ok=ok, detail=detail, unhealthy_after=self.unhealthy_after
            )

    async def check_all(self) -> list[AgentRecord]:
        targets = [
            r
            for r in await self.registry.repository.list_all()
            if r.runtime_type == RuntimeType.REMOTE_HTTP
            and r.service_url
            and r.status in (AgentStatus.ACTIVE, AgentStatus.DEPRECATED)
            and r.health != HealthStatus.OFFLINE
        ]
        if not targets:
            return []
        return list(await asyncio.gather(*(self.probe(r) for r in targets)))

    async def _loop(self) -> None:
        while True:
            try:
                await self.check_all()
            except Exception:
                logger.exception("health monitor iteration failed")
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="agent-health-monitor")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
