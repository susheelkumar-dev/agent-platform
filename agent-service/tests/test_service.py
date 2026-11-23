"""End-to-end tests of the HTTP + SSE contract with a scripted model (no API keys, no network, no database)."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

KEY = "test-internal-key-0123456789abcdef"


class ScriptedModel(BaseChatModel):
    """Router: answers with a route word. Agents: call a tool when asked to, then summarise the tool result."""

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Any, **kw: Any) -> ScriptedModel:
        return self

    def _reply(self, messages: list[Any]) -> AIMessage:
        system = next((str(m.content) for m in messages if isinstance(m, SystemMessage)), "")
        last = messages[-1]
        if "Classify" in system:
            text = str(last.content).lower()
            return AIMessage("gridtrade" if "trade" in text else "migration" if "migrat" in text else "general")
        if isinstance(last, ToolMessage):
            return AIMessage(f"Done: {str(last.content)[:60]}")
        text = str(last.content).lower()
        m = re.search(r"confirm trade (\d+)", text)
        if m:
            return AIMessage("", tool_calls=[{"name": "confirm_trade", "args": {"trade_id": int(m.group(1))}, "id": "c1"}])
        if "migrat" in text:
            return AIMessage("", tool_calls=[{"name": "migration_summary", "args": {}, "id": "m1"}])
        return AIMessage("Hello from the lab guide.")

    def _generate(self, messages, stop=None, run_manager=None, **kw) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._reply(messages))])

    def _stream(self, messages, stop=None, run_manager=None, **kw):
        reply = self._reply(messages)
        if reply.tool_calls:
            yield ChatGenerationChunk(message=AIMessageChunk(content="", tool_call_chunks=[
                {"name": tc["name"], "args": json.dumps(tc["args"]), "id": tc["id"], "index": 0} for tc in reply.tool_calls]))
            return
        delay = float(os.environ.get("SCRIPTED_TOKEN_DELAY", "0"))  # fake_server.py: prove the proxy does not buffer
        for word in str(reply.content).split(" "):
            if delay:
                time.sleep(delay)
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=word + " "))
            if run_manager:
                run_manager.on_llm_new_token(word + " ", chunk=chunk)
            yield chunk


class FakeGridTrade:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def request(self, method: str, path: str, **kw: Any) -> Any:
        self.calls.append((method, path))
        if path.startswith("/trades/") and method == "GET":
            return {"id": 7, "tradeRef": "TR-7", "status": "New", "volumeMw": 10}
        if path.endswith("/confirm"):
            return {"id": 7, "status": "Confirmed"}
        return {}

    async def aclose(self) -> None:
        return None


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", KEY)
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from agentsvc import config, llm_factory
    from agentsvc.tools import gridtrade

    config.get_settings.cache_clear()
    llm_factory.set_model_override(ScriptedModel())
    fake = FakeGridTrade()
    monkeypatch.setattr(gridtrade.client, "request", fake.request)
    import main

    with TestClient(main.app) as client:
        yield client, fake
    llm_factory.set_model_override(None)
    config.get_settings.cache_clear()


def headers(user: str = "visitor-1") -> dict[str, str]:
    return {"X-Internal-Api-Key": KEY, "X-User-Id": user}


def events(client: TestClient, path: str, body: dict, user: str = "visitor-1") -> list[tuple[str, Any]]:
    out = []
    with client.stream("POST", path, json=body, headers=headers(user)) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers["x-accel-buffering"] == "no"
        event = None
        for line in r.iter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                out.append((event, json.loads(line[6:])))
    return out


def test_health_needs_no_key(env):
    client, _ = env
    assert client.get("/health").json()["status"] == "ok"


def test_api_requires_internal_key_and_user(env):
    client, _ = env
    assert client.post("/api/v1/agent/stream", json={"message": "hi"}).status_code == 401
    bad = {"X-Internal-Api-Key": "wrong", "X-User-Id": "u1"}
    assert client.post("/api/v1/agent/stream", json={"message": "hi"}, headers=bad).status_code == 401
    no_user = {"X-Internal-Api-Key": KEY}
    assert client.post("/api/v1/agent/stream", json={"message": "hi"}, headers=no_user).status_code == 400


def test_general_question_streams_tokens_and_threads_are_private(env):
    client, _ = env
    evs = events(client, "/api/v1/agent/stream", {"message": "what is this lab?"})
    kinds = [e for e, _ in evs]
    assert kinds[0] == "metadata" and kinds[-1] == "done"
    assert evs[-1][1]["status"] == "completed"
    text = "".join(d["text"] for e, d in evs if e == "token")
    assert "Hello from the lab guide." in text
    assert not any(d.get("node") == "router" for e, d in evs if e == "token")  # router words never leak
    tid = evs[0][1]["thread_id"]
    thread = client.get(f"/api/v1/agent/threads/{tid}", headers=headers()).json()
    assert thread["status"] == "done" and thread["messages"][-1]["role"] == "assistant"
    assert client.get(f"/api/v1/agent/threads/{tid}", headers=headers("someone-else")).status_code == 404
    assert [t["thread_id"] for t in client.get("/api/v1/agent/threads", headers=headers()).json()] == [tid]


def test_write_tool_pauses_for_approval_and_resumes(env):
    client, fake = env
    evs = events(client, "/api/v1/agent/stream", {"message": "please confirm trade 7"})
    intr = next(d for e, d in evs if e == "interrupt")
    assert evs[-1] == ("done", {"thread_id": intr["thread_id"], "status": "interrupted"})
    assert intr["kind"] == "approval" and intr["action"]["tool"] == "confirm_trade"
    assert ("POST", "/trades/7/confirm") not in fake.calls  # nothing changed before approval
    tid = intr["thread_id"]

    blocked = client.post("/api/v1/agent/stream", json={"thread_id": tid, "message": "hello?"}, headers=headers())
    assert blocked.status_code == 409
    wrong = client.post("/api/v1/agent/resume", headers=headers(),
                        json={"thread_id": tid, "interrupt_id": "nope", "decision": "approve"})
    assert wrong.status_code == 409
    stranger = client.post("/api/v1/agent/resume", headers=headers("intruder"),
                           json={"thread_id": tid, "interrupt_id": intr["interrupt_id"], "decision": "approve"})
    assert stranger.status_code == 404

    done = events(client, "/api/v1/agent/resume",
                  {"thread_id": tid, "interrupt_id": intr["interrupt_id"], "decision": "approve"})
    assert done[-1][1]["status"] == "completed"
    assert ("POST", "/trades/7/confirm") in fake.calls
    assert "Confirmed" in "".join(d["text"] for e, d in done if e == "token")


def test_rejected_approval_changes_nothing(env):
    client, fake = env
    evs = events(client, "/api/v1/agent/stream", {"message": "confirm trade 9"})
    intr = next(d for e, d in evs if e == "interrupt")
    done = events(client, "/api/v1/agent/resume",
                  {"thread_id": intr["thread_id"], "interrupt_id": intr["interrupt_id"], "decision": "reject"})
    assert done[-1][1]["status"] == "completed"
    assert not any(p.endswith("/confirm") for _, p in fake.calls)


def test_migration_analyst_reads_the_bundled_report(env):
    client, _ = env
    evs = events(client, "/api/v1/agent/stream", {"message": "summarise the migration"})
    tools = [d.get("tool") for e, d in evs if e == "step" and d.get("tool")]
    assert "migration_summary" in tools
    assert evs[-1][1]["status"] == "completed"


def test_message_size_limit(env):
    client, _ = env
    r = client.post("/api/v1/agent/stream", json={"message": "x" * 5000}, headers=headers())
    assert r.status_code == 413
