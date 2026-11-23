"""Contract tests for the agent-service SDK (Gap G24)."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from ai_agent_sdk import AgentResult, AgentServiceSettings, BaseAgent, capability, create_agent_app
from ai_agent_sdk.testing import (
    FakePlatformServices,
    check_agent_service,
    lifespan,
    make_request,
    run_agent_locally,
)
from ai_core.config import DEV_SERVICE_TOKEN, DEV_SIGNING_SECRET
from ai_security.signing import SIGNATURE_HEADER, sign_request
from examples.agents.inventory_agent.agent import InventoryAgent

pytestmark = pytest.mark.anyio


def standalone(agent, **kw) -> tuple:
    settings = AgentServiceSettings(_env_file=None, auto_register=False, service_url="http://agent.test", **kw)
    app = create_agent_app(agent, settings=settings)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent.test")
    return app, client


def signed(body: dict) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    return raw, {"Authorization": f"Bearer {DEV_SERVICE_TOKEN}", SIGNATURE_HEADER: sign_request(DEV_SIGNING_SECRET, raw),
                 "Content-Type": "application/json"}


async def test_example_agent_passes_contract_check():
    app, client = standalone(InventoryAgent())
    async with lifespan(app), client:
        report = await check_agent_service(client, "http://agent.test", service_token=DEV_SERVICE_TOKEN,
                                           signing_secret=DEV_SIGNING_SECRET)
    assert report.passed, report.render()


async def test_signature_is_required_and_verified():
    app, client = standalone(InventoryAgent())
    async with lifespan(app), client:
        req = make_request(InventoryAgent(), {"message": "x"}).model_dump(mode="json")
        raw, headers = signed(req)
        assert (await client.post("/api/v1/execute", content=raw, headers=headers)).status_code == 200
        headers[SIGNATURE_HEADER] = sign_request("wrong-secret", raw)
        r = await client.post("/api/v1/execute", content=raw, headers=headers)
        assert r.status_code == 401 and r.json()["error"]["code"] == "BAD_SIGNATURE"
        del headers[SIGNATURE_HEADER]
        assert (await client.post("/api/v1/execute", content=raw, headers=headers)).status_code == 401


async def test_wrong_agent_and_invalid_input_are_rejected():
    app, client = standalone(InventoryAgent())
    async with lifespan(app), client:
        req = make_request(InventoryAgent(), {"period": 12345678}).model_dump(mode="json")
        raw, headers = signed({**req, "agent_id": "someone-else"})
        assert (await client.post("/api/v1/execute", content=raw, headers=headers)).status_code == 400
        raw, headers = signed({**req, "input": {"period": ["not", "a", "string"]}})
        r = await client.post("/api/v1/execute", content=raw, headers=headers)
        assert r.status_code == 422 and r.json()["error"]["code"] == "INPUT_INVALID"


class CountingAgent(BaseAgent):
    agent_id = "counting-agent"
    name = "Counting"
    version = "1.0.0"
    capabilities = [capability("test.count.run", "count", keywords=["count"])]
    max_concurrency = 1

    def __init__(self):
        super().__init__()
        self.calls = 0

    async def execute(self, request, context):
        self.calls += 1
        await asyncio.sleep(0.2)
        if request.input.get("explode"):
            raise RuntimeError("kaboom")
        return AgentResult.success({"n": self.calls}, summary="counted")


async def test_idempotent_replay_concurrency_limit_and_error_mapping():
    agent = CountingAgent()
    app, client = standalone(agent)
    async with lifespan(app), client:
        req = make_request(agent, {}, idempotency_key="exec-1:s1").model_dump(mode="json")
        raw, headers = signed(req)
        first = (await client.post("/api/v1/execute", content=raw, headers=headers)).json()
        again = (await client.post("/api/v1/execute", content=raw, headers=headers)).json()
        assert first == again and agent.calls == 1  # retry with same key is not re-executed

        r1, r2 = [make_request(agent, {}, idempotency_key=k).model_dump(mode="json") for k in ("a", "b")]
        responses = await asyncio.gather(
            client.post("/api/v1/execute", content=signed(r1)[0], headers=signed(r1)[1]),
            client.post("/api/v1/execute", content=signed(r2)[0], headers=signed(r2)[1]),
        )
        assert sorted(r.status_code for r in responses) == [200, 429]

        boom = make_request(agent, {"explode": True}).model_dump(mode="json")
        result = (await client.post("/api/v1/execute", content=signed(boom)[0], headers=signed(boom)[1])).json()
        assert result["status"] == "error" and result["error"]["code"] == "AGENT_EXCEPTION"
        assert result["error"]["retryable"] is False


async def test_agents_can_be_unit_tested_without_http():
    result = await run_agent_locally(InventoryAgent(), {"period": "q3"}, context=None)
    assert result.output["period"] == "q3" and result.artifacts[0]["type"] == "metric"

    class UsesLLM(BaseAgent):
        agent_id = "uses-llm"
        name = "x"
        version = "1.0.0"
        capabilities = ["test.llm.run"]

        async def execute(self, request, context):
            r = await self.platform.generate(context, "hello")
            return AgentResult.success(summary=r.content)

    agent = UsesLLM()
    agent.platform = FakePlatformServices(llm_reply="canned")
    assert (await run_agent_locally(agent)).summary == "canned"
