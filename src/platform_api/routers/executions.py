"""Execution state API (LLD §22): inspect, cancel and stream executions."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Query

from ai_core.errors import NotFoundError
from ai_core.events import PlatformEvent
from ai_core.models import ExecutionRecord, UserContext
from platform_api.container import PlatformContainer
from platform_api.deps import current_user, get_container
from platform_api.sse import event_stream, sse_response

router = APIRouter(prefix="/api/v1/executions", tags=["executions"])


async def _load(c: PlatformContainer, user: UserContext, execution_id: str) -> ExecutionRecord:
    record = await c.executions.get(execution_id)
    if record is None or record.tenant_id != user.tenant_id or (
        record.user_id != user.user_id and not user.is_admin
    ):
        raise NotFoundError(f"Execution '{execution_id}' not found")
    return record


@router.get("")
async def list_executions(
    limit: int = Query(default=20, le=200),
    user: UserContext = Depends(current_user),
    c: PlatformContainer = Depends(get_container),
) -> list[dict[str, Any]]:
    records = await c.executions.list(user.tenant_id, None if user.is_admin else user.user_id, limit)
    return [r.summary() for r in records]


@router.get("/{execution_id}", response_model=ExecutionRecord)
async def get_execution(
    execution_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> ExecutionRecord:
    return await _load(c, user, execution_id)


@router.post("/{execution_id}/cancel")
async def cancel_execution(
    execution_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> dict[str, Any]:
    record = await _load(c, user, execution_id)
    if record.status.terminal:
        return {"execution_id": execution_id, "cancelled": False, "status": record.status,
                "reason": "execution already finished"}
    cancelled = await c.engine.cancel(execution_id)
    return {
        "execution_id": execution_id,
        "cancelled": cancelled,
        "status": "CANCELLING" if cancelled else record.status,
        "reason": None if cancelled else "execution is not running on this replica (or not started yet)",
    }


@router.get("/{execution_id}/events", summary="Server-Sent Events for an execution")
async def execution_events(
    execution_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
):
    record = await _load(c, user, execution_id)
    if c.bus.has_history(execution_id) or c.engine.is_running(execution_id):
        return sse_response(event_stream(c.bus.subscribe(execution_id)))

    async def poll():
        """Fallback when the execution ran on another replica: stream persisted snapshots."""
        nonlocal record
        last = None
        while True:
            snapshot = record.summary()
            if snapshot != last:
                yield PlatformEvent(event_type="ExecutionSnapshot", tenant_id=record.tenant_id,
                                    execution_id=execution_id, payload={k: str(v) if k.endswith("_at") else v
                                                                        for k, v in snapshot.items()})
                last = snapshot
            if record.status.terminal:
                yield PlatformEvent(event_type="ExecutionFinished", tenant_id=record.tenant_id,
                                    execution_id=execution_id,
                                    payload={"status": record.status, "response": record.response, "ui": record.ui})
                return
            await asyncio.sleep(1.0)
            record = await _load(c, user, execution_id)

    return sse_response(event_stream(poll()))
