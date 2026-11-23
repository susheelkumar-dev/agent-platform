"""End-to-end: platform + two independently deployed agent services over HTTP (in-process transport)."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.anyio


async def test_agents_self_register_without_platform_code_changes(stack):
    r = await stack.client.get("/api/v1/agents", headers=stack.headers())
    assert r.status_code == 200
    by_id = {a["agent_id"]: a for a in r.json()}
    assert by_id["inventory-agent"]["runtime_type"] == "remote_http"
    assert by_id["inventory-agent"]["service_url"] == "http://inventory.test"
    assert by_id["exposure-agent"]["routable"] is True
    caps = {c["name"] for c in (await stack.client.get("/api/v1/capabilities", headers=stack.headers())).json()}
    assert {"inventory.valuation.read", "trading.exposure.read", "platform.chart.generate"} <= caps


async def test_single_agent_request(stack):
    r = await stack.chat("Show inventory valuation for last month")
    body = r.json()
    assert r.status_code == 200, body
    assert body["status"] == "COMPLETED"
    assert body["capabilities"] == ["inventory.valuation.read"]
    assert "1,250,000 USD" in body["response"]
    assert {b["type"] for b in body["ui"]} == {"metric", "table"}
    assert body["steps"]["s1"]["agent_id"] == "inventory-agent"


async def test_compare_runs_parallel_steps_and_aggregates(stack):
    r = await stack.chat("Compare my inventory valuation with my gas and power trading exposure")
    body = r.json()
    assert body["status"] == "COMPLETED", body
    plan = body["plan"]["steps"]
    assert [s["step_id"] for s in plan] == ["s1", "s2", "aggregate"]
    assert plan[2]["depends_on"] == ["s1", "s2"]
    assert all(body["steps"][s]["status"] == "SUCCEEDED" for s in ("s1", "s2", "aggregate"))
    types = [b["type"] for b in body["ui"]]
    assert "chart" in types and types.count("table") >= 3
    comparison = next(b for b in body["ui"] if b["type"] == "table" and "commodity" in b["title"])
    gas = next(r for r in comparison["rows"] if r["commodity"] == "Gas")
    assert gas["inventory_value"] == 690000 and gas["exposure"] == 5810000
    assert "×" in body["response"]


async def test_chart_follow_up_reuses_conversation_result(stack):
    first = (await stack.chat("Show inventory valuation for last month", conversation_id="conv-1")).json()
    assert first["status"] == "COMPLETED"
    r = await stack.chat("Now make it a bar chart", conversation_id="conv-1")
    body = r.json()
    assert body["status"] == "COMPLETED", body
    assert body["capabilities"] == ["platform.chart.generate"]
    chart = body["ui"][0]
    assert chart["type"] == "chart" and chart["x"] == "item" and chart["y"] == ["value"]
    assert len(chart["data"]) == 4


async def test_unmatched_request_lists_capabilities(stack):
    body = (await stack.chat("hello there")).json()
    assert body["status"] == "COMPLETED"
    assert body["capabilities"] == ["platform.chat.general"]
    assert "Inventory valuation" in body["response"]


async def test_permission_denied_is_rejected_with_policy_reason(stack):
    body = (await stack.chat("Show trading exposure", token="demo-viewer")).json()
    assert body["status"] == "REJECTED"
    assert body["error"]["code"] == "POLICY_DENIED"
    assert "trading.exposure.read" in body["response"]


async def test_unauthenticated_requests_are_refused(stack):
    r = await stack.client.post("/api/v1/chat", json={"message": "x"})
    assert r.status_code == 401
    r = await stack.client.post("/api/v1/chat", json={"message": "x"}, headers=stack.headers("nope"))
    assert r.status_code == 401
