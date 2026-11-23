"""SSE: LangGraph ``astream_events(version="v2")`` mapped to a small, stable envelope.

Raw v2 events are large and expose internals (prompts, full state), so the client only ever sees:

    event: metadata   {"thread_id", "run_id"}
    event: step       {"node", "status": "start"|"end", "tool"?, "input"?, "output"?}
    event: token      {"node", "text"}
    event: interrupt  {"thread_id", "interrupt_id", "kind", "title", "action", "preview", "options"}
    event: error      {"code", "message", "retryable"}
    event: done       {"thread_id", "status": "completed"|"interrupted"|"failed"}
    : keep-alive      (comment line every N seconds, so IIS / proxies keep an idle stream open)
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from .graph import ANSWER_NODES

logger = logging.getLogger("agentsvc.stream")

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
VISIBLE_NODES = ANSWER_NODES | {"router", "gridtrade_tools", "migration_tools"}


def sse(event: str, data: Any) -> str:
    payload = json.dumps(data, default=str, separators=(",", ":"), ensure_ascii=False)
    return f"event: {event}\n" + "".join(f"data: {line}\n" for line in payload.splitlines() or [""]) + "\n"


def _text(chunk: Any) -> str:
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # Gemini / Anthropic style content parts
        return "".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


def _short(value: Any, limit: int = 400) -> Any:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else text[:limit] + "…"


async def run_events(graph: Any, graph_input: Any, config: dict[str, Any], thread_id: str) -> AsyncIterator[str]:
    """Stream one run of the graph. Never raises: failures become an ``error`` + ``done`` pair."""
    run_id = str(uuid.uuid4())
    yield sse("metadata", {"thread_id": thread_id, "run_id": run_id})
    current: str | None = None
    try:
        async for ev in graph.astream_events(graph_input, config=config, version="v2"):
            kind = ev["event"]
            node = (ev.get("metadata") or {}).get("langgraph_node")
            if node and node != current and node in VISIBLE_NODES:
                if current:
                    yield sse("step", {"node": current, "status": "end"})
                current = node
                yield sse("step", {"node": node, "status": "start"})
            if kind == "on_chat_model_stream" and node in ANSWER_NODES:
                text = _text(ev["data"].get("chunk"))
                if text:
                    yield sse("token", {"node": node, "text": text})
            elif kind == "on_tool_start":
                yield sse("step", {"node": node, "status": "start", "tool": ev.get("name"),
                                   "input": _short(ev["data"].get("input"))})
            elif kind == "on_tool_end":
                out = ev["data"].get("output")
                yield sse("step", {"node": node, "status": "end", "tool": ev.get("name"),
                                   "output": _short(getattr(out, "content", out))})
        if current:
            yield sse("step", {"node": current, "status": "end"})

        snapshot = await graph.aget_state(config)
        pending = list(getattr(snapshot, "interrupts", ()) or ())
        if pending:
            intr = pending[0]
            value = intr.value if isinstance(intr.value, dict) else {"title": str(intr.value)}
            yield sse("interrupt", {"thread_id": thread_id, "interrupt_id": intr.id, **value})
            yield sse("done", {"thread_id": thread_id, "status": "interrupted"})
        else:
            yield sse("done", {"thread_id": thread_id, "status": "completed"})
    except asyncio.CancelledError:
        raise  # client disconnected: the checkpoint keeps what finished
    except Exception as exc:  # noqa: BLE001
        logger.exception("run failed thread=%s", thread_id)
        retryable = any(w in type(exc).__name__.lower() for w in ("timeout", "ratelimit", "connect", "unavailable"))
        yield sse("error", {"code": type(exc).__name__, "message": "The agents could not finish this request."
                            if not retryable else "A model provider is busy; try again in a moment.",
                            "retryable": retryable})
        yield sse("done", {"thread_id": thread_id, "status": "failed"})


async def with_keepalive(source: AsyncIterator[str], every: float) -> AsyncIterator[str]:
    """Interleave ``: keep-alive`` comments without cancelling the pending read (that would end the run)."""
    iterator = source.__aiter__()
    pending: asyncio.Future | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(anext(iterator))
            done, _ = await asyncio.wait({pending}, timeout=every)
            if not done:
                yield ": keep-alive\n\n"
                continue
            try:
                chunk = pending.result()
            except StopAsyncIteration:
                pending = None
                break
            pending = None
            yield chunk
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
        with contextlib.suppress(Exception):
            await iterator.aclose()  # type: ignore[attr-defined]
