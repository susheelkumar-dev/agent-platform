"""Audit trail (Gap G20): security- and lifecycle-relevant events, persisted."""

from __future__ import annotations

import logging

from ai_core.events import EventType, PlatformEvent
from ai_core.interfaces import AuditStore
from ai_core.models.ops import AuditEvent

logger = logging.getLogger("ai_observability.audit")

AUDITED_EVENTS = {
    EventType.AGENT_REGISTERED: "agent.register",
    EventType.AGENT_DEREGISTERED: "agent.deregister",
    EventType.AGENT_STATUS_CHANGED: "agent.status",
    EventType.AGENT_HEALTH_CHANGED: "agent.health",
    EventType.PLAN_REJECTED: "execution.rejected",
    EventType.EXECUTION_COMPLETED: "execution.completed",
    EventType.EXECUTION_FAILED: "execution.failed",
    EventType.EXECUTION_CANCELLED: "execution.cancelled",
    EventType.POLICY_VIOLATION: "policy.violation",
    EventType.GUARDRAIL_TRIGGERED: "guardrail.triggered",
    EventType.DOCUMENT_INGESTION_COMPLETED: "document.ingested",
    EventType.DOCUMENT_INGESTION_FAILED: "document.failed",
}


class AuditLogger:
    def __init__(self, store: AuditStore) -> None:
        self.store = store

    async def record(self, event: AuditEvent) -> None:
        try:
            await self.store.append(event)
        except Exception:  # audit must never break the request path
            logger.exception("failed to write audit event %s", event.action)

    async def on_event(self, event: PlatformEvent) -> None:
        action = AUDITED_EVENTS.get(event.event_type)
        if action is None:
            return
        payload = event.payload
        resource = None
        if "agent_id" in payload:
            resource = f"agent:{payload['agent_id']}@{payload.get('version')}"
        elif event.execution_id:
            resource = f"execution:{event.execution_id}"
        elif "document_id" in payload:
            resource = f"document:{payload['document_id']}"
        outcome = "failure" if event.event_type in (
            EventType.EXECUTION_FAILED, EventType.PLAN_REJECTED, EventType.POLICY_VIOLATION,
            EventType.DOCUMENT_INGESTION_FAILED,
        ) else "success"
        await self.record(
            AuditEvent(
                tenant_id=event.tenant_id,
                actor=event.actor,
                action=action,
                resource=resource,
                outcome=outcome,
                request_id=event.request_id,
                execution_id=event.execution_id,
                details={k: v for k, v in payload.items() if k not in {"result", "ui"}},
            )
        )
