"""The platform mounted inside an existing FastAPI app, with an in-process agent."""

from __future__ import annotations

from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI

from ai_agent_sdk.testing import lifespan
from ai_platform_client import AsyncPlatformClient
from examples.embedded_app.app import OrdersAgent
from platform_api import create_app
from tests.conftest import make_settings

pytestmark = pytest.mark.anyio


async def test_mounted_platform_with_local_agent():
    ai = create_app(make_settings(), local_agents=[OrdersAgent()], configure_logs=False)

    @asynccontextmanager
    async def host_lifespan(app):
        async with ai.router.lifespan_context(ai):
            yield

    host = FastAPI(lifespan=host_lifespan)

    @host.get("/orders")
    async def orders():
        return []

    host.mount("/ai", ai)
    async with lifespan(host):
        transport = httpx.ASGITransport(app=host)
        async with AsyncPlatformClient("http://host.test/ai", "demo-user", transport=transport) as client:
            result = await client.chat("Show my open orders")
            assert result["status"] == "COMPLETED", result
            assert result["steps"]["s1"]["agent_id"] == "orders-agent"
            agents = await client.list_agents()
            assert any(a["agent_id"] == "orders-agent" and a["runtime_type"] == "local" for a in agents)
            events = [e async for e in client.chat_stream("Show my open orders")]
            assert events[-1]["event_type"] == "ExecutionCompleted"
        async with httpx.AsyncClient(transport=transport, base_url="http://host.test") as raw:
            ui = await raw.get("/ai/")
            assert ui.status_code == 200 and 'fetch("ready")' in ui.text
            assert (await raw.get("/orders")).status_code == 200
