from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from ai_agent_sdk import AgentServiceSettings, create_agent_app
from ai_agent_sdk.testing import RoutingTransport, lifespan
from ai_core.config import Settings
from examples.agents.exposure_agent.agent import ExposureAgent
from examples.agents.inventory_agent.agent import InventoryAgent
from platform_api.app import create_app

PLATFORM = "http://platform.test"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def make_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = dict(
        _env_file=None,
        database_url="memory",
        enable_health_monitor=False,
        rate_limit_per_minute=0,
        log_level="WARNING",
        retry_backoff_seconds=0.01,
    )
    base.update(overrides)
    return Settings(**base)


def agent_settings(host: str, **overrides: Any) -> AgentServiceSettings:
    base: dict[str, Any] = dict(
        _env_file=None,
        platform_url=PLATFORM,
        service_url=f"http://{host}",
        heartbeat_interval_seconds=0.2,
    )
    base.update(overrides)
    return AgentServiceSettings(**base)


@dataclass
class Stack:
    transport: RoutingTransport
    platform: Any
    client: httpx.AsyncClient
    agents: dict[str, Any]

    @property
    def container(self):
        return self.platform.state.container

    def headers(self, token: str = "demo-user") -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    async def chat(self, message: str, token: str = "demo-user", **body: Any) -> httpx.Response:
        return await self.client.post("/api/v1/chat", json={"message": message, **body}, headers=self.headers(token))


async def wait_for(predicate, within: float = 5.0, interval: float = 0.02) -> None:
    deadline = asyncio.get_event_loop().time() + within
    while asyncio.get_event_loop().time() < deadline:
        result = predicate()
        if asyncio.iscoroutine(result):
            result = await result
        if result:
            return
        await asyncio.sleep(interval)
    raise AssertionError("condition not met in time")


@contextlib.asynccontextmanager
async def running_stack(settings: Settings | None = None, *, agents: dict[str, Any] | None = None,
                        **app_kwargs: Any) -> AsyncIterator[Stack]:
    transport = RoutingTransport()
    platform = create_app(settings or make_settings(), agent_transport=transport, configure_logs=False, **app_kwargs)
    transport.add("platform.test", platform)
    agents = agents if agents is not None else {
        "inventory.test": InventoryAgent(),
        "exposure.test": ExposureAgent(),
    }
    agent_apps = {
        host: create_agent_app(agent, settings=agent_settings(host), transport=transport)
        for host, agent in agents.items()
    }
    for host, app in agent_apps.items():
        transport.add(host, app)
    async with contextlib.AsyncExitStack() as stack:
        await stack.enter_async_context(lifespan(platform))
        for app in agent_apps.values():
            await stack.enter_async_context(lifespan(app))
        container = platform.state.container

        async def all_registered() -> bool:
            ids = {r.agent_id for r in await container.registry.list_agents()}
            return all(a.id in ids for a in agents.values())

        await wait_for(all_registered)
        client = httpx.AsyncClient(transport=transport, base_url=PLATFORM, timeout=30)
        stack.push_async_callback(client.aclose)
        yield Stack(transport, platform, client, agent_apps)


@pytest.fixture
async def stack() -> AsyncIterator[Stack]:
    async with running_stack() as s:
        yield s
