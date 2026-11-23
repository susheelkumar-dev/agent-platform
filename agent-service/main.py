"""Agent service: FastAPI + LangGraph with SSE streaming, Neon checkpoints and human-in-the-loop approvals.

Endpoints (all /api routes need X-Internal-Api-Key and X-User-Id, set by the portfolio BFF):
    GET  /health                          liveness, no database call (does not wake Neon)
    GET  /ready                           database + provider readiness
    POST /api/v1/agent/stream             start or continue a thread             -> text/event-stream
    POST /api/v1/agent/resume             answer a pending approval              -> text/event-stream
    GET  /api/v1/agent/threads            the caller's threads
    GET  /api/v1/agent/threads/{id}       one thread: status, pending approval, messages

Run: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command
from pydantic import BaseModel, Field

from agentsvc import __version__
from agentsvc.config import Settings, get_settings
from agentsvc.graph import build_graph
from agentsvc.llm_factory import configured_providers
from agentsvc.memory import open_persistence
from agentsvc.security import Caller, require_caller
from agentsvc.streaming import SSE_HEADERS, run_events, with_keepalive
from agentsvc.tools.gridtrade import client as gridtrade_client

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("agentsvc")

THREAD_ID_PATTERN = r"^[A-Za-z0-9-]{8,64}$"


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    problems = s.problems()
    if problems:
        (logger.error if s.is_production else logger.warning)("configuration: %s", "; ".join(problems))
        if s.is_production:
            raise RuntimeError("refusing to start: " + "; ".join(problems))
    if s.langsmith_api_key:
        os.environ.setdefault("LANGSMITH_TRACING", "true")
        os.environ.setdefault("LANGSMITH_API_KEY", s.langsmith_api_key.get_secret_value())
        os.environ.setdefault("LANGSMITH_PROJECT", s.langsmith_project)
    persistence = await open_persistence(s)
    app.state.persistence = persistence
    app.state.graph = build_graph(s, persistence.checkpointer)
    logger.info("agent-service %s ready: checkpoints=%s providers=%s", __version__, persistence.kind,
                ",".join(configured_providers(s)) or "none")
    try:
        yield
    finally:
        await gridtrade_client.aclose()
        await persistence.close()


app = FastAPI(title="Agent Service", version=__version__, lifespan=lifespan,
              docs_url=None if os.environ.get("ENVIRONMENT") == "production" else "/docs", redoc_url=None)


# ---------------------------------------------------------------- models
class StreamRequest(BaseModel):
    thread_id: str | None = Field(default=None, pattern=THREAD_ID_PATTERN)
    message: str = Field(min_length=1)


class ResumeRequest(BaseModel):
    thread_id: str = Field(pattern=THREAD_ID_PATTERN)
    interrupt_id: str = Field(min_length=1, max_length=128)
    decision: Literal["approve", "reject"]
    comment: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------- helpers
def _config(thread_id: str, caller: Caller, s: Settings) -> dict[str, Any]:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": s.recursion_limit,
            "metadata": {"user_id": caller.user_id, "request_id": caller.request_id}}


async def _owned(request: Request, thread_id: str, caller: Caller) -> None:
    owner = await request.app.state.persistence.threads.owner(thread_id)
    if owner is None or owner != caller.user_id:
        raise HTTPException(404, "thread not found")  # same answer for "missing" and "not yours"


def _stream(request: Request, graph_input: Any, thread_id: str, caller: Caller, s: Settings) -> StreamingResponse:
    events = run_events(request.app.state.graph, graph_input, _config(thread_id, caller, s), thread_id)
    return StreamingResponse(with_keepalive(events, s.stream_keepalive_seconds),
                             media_type="text/event-stream", headers=SSE_HEADERS)


def _message_view(m: Any) -> dict[str, Any] | None:
    if isinstance(m, HumanMessage):
        return {"role": "user", "content": str(m.content)}
    if isinstance(m, AIMessage) and m.content and not m.tool_calls:
        content = m.content if isinstance(m.content, str) else "".join(
            p.get("text", "") for p in m.content if isinstance(p, dict))
        return {"role": "assistant", "content": content}
    if isinstance(m, ToolMessage):
        return None
    return None


# ---------------------------------------------------------------- routes
@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/ready", include_in_schema=False)
async def ready(request: Request, s: Settings = Depends(get_settings)) -> JSONResponse:
    try:
        db = await request.app.state.persistence.threads.ping()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ready: database unreachable: %s", exc)
        db = False
    providers = configured_providers(s)
    ok = db and bool(providers)
    return JSONResponse({"status": "ready" if ok else "degraded", "db": db, "providers": providers},
                        status_code=200 if ok else 503)


@app.post("/api/v1/agent/stream")
async def stream(body: StreamRequest, request: Request, caller: Caller = Depends(require_caller),
                 s: Settings = Depends(get_settings)) -> StreamingResponse:
    message = body.message.strip()
    if len(message) > s.max_message_chars:
        raise HTTPException(413, f"message is longer than {s.max_message_chars} characters")
    threads = request.app.state.persistence.threads
    if body.thread_id:
        await _owned(request, body.thread_id, caller)
        snapshot = await request.app.state.graph.aget_state(_config(body.thread_id, caller, s))
        if getattr(snapshot, "interrupts", ()):
            raise HTTPException(409, "this thread is waiting for an approval: call /api/v1/agent/resume")
        thread_id = body.thread_id
        await threads.touch(thread_id)
    else:
        thread_id = str(uuid.uuid4())
        await threads.claim(thread_id, caller.user_id, message)
    return _stream(request, {"messages": [HumanMessage(message)]}, thread_id, caller, s)


@app.post("/api/v1/agent/resume")
async def resume(body: ResumeRequest, request: Request, caller: Caller = Depends(require_caller),
                 s: Settings = Depends(get_settings)) -> StreamingResponse:
    await _owned(request, body.thread_id, caller)
    snapshot = await request.app.state.graph.aget_state(_config(body.thread_id, caller, s))
    pending = {i.id for i in getattr(snapshot, "interrupts", ()) or ()}
    if body.interrupt_id not in pending:
        raise HTTPException(409, "no such pending approval on this thread (already answered?)")
    decision = {"decision": body.decision, "comment": body.comment or "", "by": caller.user_id}
    await request.app.state.persistence.threads.touch(body.thread_id)
    return _stream(request, Command(resume={body.interrupt_id: decision}), body.thread_id, caller, s)


@app.get("/api/v1/agent/threads")
async def list_threads(request: Request, caller: Caller = Depends(require_caller)) -> list[dict[str, Any]]:
    return await request.app.state.persistence.threads.list(caller.user_id, 30)


@app.get("/api/v1/agent/threads/{thread_id}")
async def get_thread(thread_id: str, request: Request, caller: Caller = Depends(require_caller),
                     s: Settings = Depends(get_settings)) -> dict[str, Any]:
    await _owned(request, thread_id, caller)
    snapshot = await request.app.state.graph.aget_state(_config(thread_id, caller, s))
    interrupts = list(getattr(snapshot, "interrupts", ()) or ())
    messages = [v for v in (_message_view(m) for m in (snapshot.values or {}).get("messages", [])) if v]
    status = "interrupted" if interrupts else ("running" if snapshot.next else ("done" if messages else "idle"))
    pending = None
    if interrupts:
        value = interrupts[0].value if isinstance(interrupts[0].value, dict) else {"title": str(interrupts[0].value)}
        pending = {"interrupt_id": interrupts[0].id, **value}
    return {"thread_id": thread_id, "status": status, "pending_interrupt": pending, "messages": messages}
