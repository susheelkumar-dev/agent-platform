"""Versioned platform events and the event bus (LLD §23).

The in-process bus supports two consumer styles:

* **listeners** – async callables invoked for every event (audit, metrics);
* **subscriptions** – async iterators filtered by execution_id (SSE streaming).

It keeps a short replay buffer per execution so a client that subscribes just
after starting an execution still sees the early events. A broker-backed bus
(Kafka/RabbitMQ/Redis) can implement the same ``EventBus`` protocol.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import OrderedDict, deque
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field

from ai_core.models.common import new_id, utcnow

logger = logging.getLogger("ai_core.events")


class EventType:
    AGENT_REGISTERED = "AgentRegistered"
    AGENT_DEREGISTERED = "AgentDeregistered"
    AGENT_HEALTH_CHANGED = "AgentHealthChanged"
    AGENT_STATUS_CHANGED = "AgentStatusChanged"
    EXECUTION_CREATED = "ExecutionCreated"
    PLAN_CREATED = "PlanCreated"
    PLAN_VALIDATED = "PlanValidated"
    PLAN_REJECTED = "PlanRejected"
    EXECUTION_STARTED = "ExecutionStarted"
    STEP_STARTED = "ExecutionStepStarted"
    STEP_RETRYING = "ExecutionStepRetrying"
    STEP_COMPLETED = "ExecutionStepCompleted"
    STEP_FAILED = "ExecutionStepFailed"
    STEP_SKIPPED = "ExecutionStepSkipped"
    EXECUTION_COMPLETED = "ExecutionCompleted"
    EXECUTION_FAILED = "ExecutionFailed"
    EXECUTION_CANCELLED = "ExecutionCancelled"
    DOCUMENT_INGESTION_STARTED = "DocumentIngestionStarted"
    DOCUMENT_INGESTION_COMPLETED = "DocumentIngestionCompleted"
    DOCUMENT_INGESTION_FAILED = "DocumentIngestionFailed"
    POLICY_VIOLATION = "PolicyViolation"
    GUARDRAIL_TRIGGERED = "GuardrailTriggered"

    TERMINAL_EXECUTION = {EXECUTION_COMPLETED, EXECUTION_FAILED, EXECUTION_CANCELLED, PLAN_REJECTED}


class PlatformEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: new_id("evt"))
    event_type: str
    version: int = 1
    timestamp: datetime = Field(default_factory=utcnow)
    tenant_id: str | None = None
    request_id: str | None = None
    execution_id: str | None = None
    actor: str | None = None
    producer: str = "ai-agent-platform"
    payload: dict[str, Any] = Field(default_factory=dict)


Listener = Callable[[PlatformEvent], Awaitable[None]]


class EventBus(Protocol):
    async def publish(self, event: PlatformEvent) -> None: ...

    def add_listener(self, listener: Listener) -> None: ...

    def subscribe(self, execution_id: str) -> AsyncIterator[PlatformEvent]: ...


class InMemoryEventBus:
    def __init__(self, replay_executions: int = 500, replay_events_per_execution: int = 200) -> None:
        self._listeners: list[Listener] = []
        self._subscribers: dict[str, set[asyncio.Queue[PlatformEvent]]] = {}
        self._replay: OrderedDict[str, deque[PlatformEvent]] = OrderedDict()
        self._replay_executions = replay_executions
        self._replay_events = replay_events_per_execution

    def add_listener(self, listener: Listener) -> None:
        self._listeners.append(listener)

    async def publish(self, event: PlatformEvent) -> None:
        if event.execution_id:
            buf = self._replay.get(event.execution_id)
            if buf is None:
                buf = deque(maxlen=self._replay_events)
                self._replay[event.execution_id] = buf
                while len(self._replay) > self._replay_executions:
                    self._replay.popitem(last=False)
            buf.append(event)
            for queue in list(self._subscribers.get(event.execution_id, ())):
                queue.put_nowait(event)
        for listener in self._listeners:
            try:
                await listener(event)
            except Exception:  # a broken listener must never break execution
                logger.exception("event listener failed for %s", event.event_type)

    def has_history(self, execution_id: str) -> bool:
        return execution_id in self._replay

    async def subscribe(self, execution_id: str) -> AsyncIterator[PlatformEvent]:
        queue: asyncio.Queue[PlatformEvent] = asyncio.Queue()
        self._subscribers.setdefault(execution_id, set()).add(queue)
        try:
            seen: set[str] = set()
            for event in list(self._replay.get(execution_id, ())):
                seen.add(event.event_id)
                yield event
                if event.event_type in EventType.TERMINAL_EXECUTION:
                    return
            while True:
                event = await queue.get()
                if event.event_id in seen:
                    continue
                yield event
                if event.event_type in EventType.TERMINAL_EXECUTION:
                    return
        finally:
            subs = self._subscribers.get(execution_id)
            if subs is not None:
                subs.discard(queue)
                if not subs:
                    with contextlib.suppress(KeyError):
                        del self._subscribers[execution_id]
