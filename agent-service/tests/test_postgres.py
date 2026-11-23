"""Checkpoints in real PostgreSQL: a paused approval survives a full restart of the service (scale to zero).

Runs when TEST_DATABASE_URL points at a PostgreSQL database (CI starts one); skipped otherwise.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from test_service import KEY, FakeGridTrade, ScriptedModel, events, headers

PG = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not PG, reason="TEST_DATABASE_URL not set")


@pytest.fixture()
def pg_env(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", KEY)
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("DATABASE_URL", PG)
    from agentsvc import config, llm_factory
    from agentsvc.tools import gridtrade

    config.get_settings.cache_clear()
    llm_factory.set_model_override(ScriptedModel())
    fake = FakeGridTrade()
    monkeypatch.setattr(gridtrade.client, "request", fake.request)
    yield fake
    llm_factory.set_model_override(None)
    config.get_settings.cache_clear()


def test_pending_approval_survives_restart(pg_env):
    import main

    with TestClient(main.app) as first:  # instance 1: ask, pause for approval, then "scale to zero"
        assert first.get("/ready").json()["db"] is True
        evs = events(first, "/api/v1/agent/stream", {"message": "confirm trade 7"}, user="pg-user")
        intr = next(d for e, d in evs if e == "interrupt")

    with TestClient(main.app) as second:  # instance 2: a cold start with nothing in memory
        thread = second.get(f"/api/v1/agent/threads/{intr['thread_id']}", headers=headers("pg-user")).json()
        assert thread["status"] == "interrupted"
        assert thread["pending_interrupt"]["interrupt_id"] == intr["interrupt_id"]
        assert second.get(f"/api/v1/agent/threads/{intr['thread_id']}", headers=headers("other")).status_code == 404

        done = events(second, "/api/v1/agent/resume",
                      {"thread_id": intr["thread_id"], "interrupt_id": intr["interrupt_id"], "decision": "approve"},
                      user="pg-user")
        assert done[-1][1]["status"] == "completed"
        assert ("POST", "/trades/7/confirm") in pg_env.calls
