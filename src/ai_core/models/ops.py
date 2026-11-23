"""Operational records: conversations, audit events and LLM usage."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from ai_core.models.common import new_id, utcnow


class Conversation(BaseModel):
    conversation_id: str
    tenant_id: str
    user_id: str
    title: str = "New conversation"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class AuditEvent(BaseModel):
    audit_id: str = Field(default_factory=lambda: new_id("aud"))
    timestamp: datetime = Field(default_factory=utcnow)
    tenant_id: str | None = None
    actor: str | None = None
    action: str
    resource: str | None = None
    outcome: str = "success"
    request_id: str | None = None
    execution_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class UsageRecord(BaseModel):
    usage_id: str = Field(default_factory=lambda: new_id("use"))
    timestamp: datetime = Field(default_factory=utcnow)
    tenant_id: str | None = None
    user_id: str | None = None
    agent_id: str | None = None
    request_id: str | None = None
    execution_id: str | None = None
    provider: str
    model: str
    purpose: str = "general"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: float = 0.0
    success: bool = True
