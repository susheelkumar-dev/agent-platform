"""Server-Sent Events helpers."""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi.responses import StreamingResponse

from ai_core.events import PlatformEvent


def format_event(event_type: str, data: Any, event_id: str | None = None) -> str:
    lines = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event_type}")
    payload = json.dumps(data, default=str, separators=(",", ":"))
    lines.extend(f"data: {line}" for line in payload.splitlines() or [""])
    return "\n".join(lines) + "\n\n"


async def event_stream(events: AsyncIterator[PlatformEvent], keepalive_seconds: float = 15.0) -> AsyncIterator[str]:
    iterator = events.__aiter__()
    pending: asyncio.Future | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(anext(iterator))
            # Do not cancel the pending read on timeout: that would close the generator.
            done, _ = await asyncio.wait({pending}, timeout=keepalive_seconds)
            if not done:
                yield ": keep-alive\n\n"
                continue
            try:
                event = pending.result()
            except StopAsyncIteration:
                pending = None
                break
            pending = None
            yield format_event(event.event_type, event.model_dump(mode="json"), event.event_id)
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
        with contextlib.suppress(Exception):
            await iterator.aclose()  # type: ignore[attr-defined]


def sse_response(stream: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
