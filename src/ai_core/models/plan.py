"""Workflow / execution plan contracts (LLD §9-12, §29-31)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from ai_core.errors import ErrorCategory, ErrorInfo
from ai_core.models.common import STEP_ID_RE, new_id, utcnow

DEFAULT_RETRY_ON = [ErrorCategory.TIMEOUT, ErrorCategory.AGENT_UNAVAILABLE, ErrorCategory.RATE_LIMIT]


class RetryPolicy(BaseModel):
    max_attempts: int = Field(default=1, ge=1, le=10)
    backoff_seconds: float = Field(default=0.5, ge=0, le=60)
    max_backoff_seconds: float = Field(default=8.0, ge=0, le=300)
    multiplier: float = Field(default=2.0, ge=1, le=10)
    retry_on: list[ErrorCategory] = Field(default_factory=lambda: list(DEFAULT_RETRY_ON))

    def delay_for(self, attempt: int) -> float:
        return min(self.backoff_seconds * (self.multiplier ** (attempt - 1)), self.max_backoff_seconds)


class TriggerRule(StrEnum):
    ALL_SUCCESS = "all_success"  # run only when every dependency succeeded (default)
    ALL_DONE = "all_done"  # run when dependencies are finished, whatever the outcome (joins/aggregators)


class PlanStep(BaseModel):
    step_id: str
    capability: str
    agent_id: str | None = None
    agent_version: str | None = None
    description: str | None = None
    input: dict[str, Any] = Field(default_factory=dict, description="Static input")
    input_mapping: dict[str, str] = Field(
        default_factory=dict,
        description="key -> reference, e.g. {'dataset': '$steps.s1.output.rows'}. Mapped values override static input.",
    )
    depends_on: list[str] = Field(default_factory=list)
    condition: str | None = Field(default=None, description="Safe expression, e.g. '$steps.s1.output.total > 0'")
    trigger: TriggerRule = TriggerRule.ALL_SUCCESS
    required: bool = True
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    timeout_seconds: float | None = Field(default=None, gt=0)

    @field_validator("step_id")
    @classmethod
    def _valid_step_id(cls, value: str) -> str:
        if not STEP_ID_RE.match(value):
            raise ValueError(f"Invalid step_id '{value}'")
        return value


class ExecutionPlan(BaseModel):
    plan_id: str = Field(default_factory=lambda: new_id("plan"))
    request_id: str | None = None
    version: str = "2"
    steps: list[PlanStep]
    variables: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def step(self, step_id: str) -> PlanStep:
        for s in self.steps:
            if s.step_id == step_id:
                return s
        raise KeyError(step_id)


class PolicyDecision(BaseModel):
    step_id: str | None = None
    policy: str
    allowed: bool
    reason: str
    details: dict[str, Any] = Field(default_factory=dict)


class ValidatedPlan(BaseModel):
    plan: ExecutionPlan
    policy_decisions: list[PolicyDecision] = Field(default_factory=list)
    execution_order: list[list[str]] = Field(default_factory=list, description="Topological levels")
    validated_at: datetime = Field(default_factory=utcnow)
    validator_version: str = "2"


class ExecutionStatus(StrEnum):
    CREATED = "CREATED"
    PLANNING = "PLANNING"
    VALIDATING = "VALIDATING"
    READY = "READY"
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"

    @property
    def terminal(self) -> bool:
        return self in TERMINAL_EXECUTION_STATUSES


TERMINAL_EXECUTION_STATUSES = {
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.CANCELLED,
    ExecutionStatus.REJECTED,
}


class StepStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"

    @property
    def terminal(self) -> bool:
        return self not in (StepStatus.PENDING, StepStatus.RUNNING)


class StepRecord(BaseModel):
    step_id: str
    capability: str
    agent_id: str | None = None
    agent_version: str | None = None
    status: StepStatus = StepStatus.PENDING
    attempts: int = 0
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: float | None = None
    result: dict[str, Any] | None = None  # serialized AgentResult
    error: ErrorInfo | None = None
    skip_reason: str | None = None


class ExecutionRecord(BaseModel):
    execution_id: str = Field(default_factory=lambda: new_id("exec"))
    request_id: str
    tenant_id: str
    user_id: str
    conversation_id: str
    message: str = ""
    status: ExecutionStatus = ExecutionStatus.CREATED
    plan: ExecutionPlan | None = None
    policy_decisions: list[PolicyDecision] = Field(default_factory=list)
    steps: dict[str, StepRecord] = Field(default_factory=dict)
    response: str | None = None
    ui: list[dict[str, Any]] = Field(default_factory=list)
    error: ErrorInfo | None = None
    usage: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None

    def summary(self) -> dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "request_id": self.request_id,
            "conversation_id": self.conversation_id,
            "status": self.status,
            "message": self.message[:200],
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "steps": {sid: s.status for sid, s in self.steps.items()},
        }


class ChatResponse(BaseModel):
    request_id: str
    execution_id: str
    conversation_id: str
    status: ExecutionStatus
    capability: str | None = None  # first capability, kept for v1 clients
    capabilities: list[str] = Field(default_factory=list)
    response: str
    plan: ExecutionPlan | None = None
    steps: dict[str, StepRecord] = Field(default_factory=dict)
    results: dict[str, Any] = Field(default_factory=dict)
    ui: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)
    error: ErrorInfo | None = None
    created_at: datetime = Field(default_factory=utcnow)


class CapabilityMatch(BaseModel):
    capability: str
    score: float
    method: Literal["explicit", "keyword", "llm", "attachment", "followup", "fallback"]
    reason: str = ""


class CapabilityResolution(BaseModel):
    matches: list[CapabilityMatch] = Field(default_factory=list)
    method: str = "keyword"
    confidence: float = 0.0
    resolver_version: str = "2"

    @property
    def capabilities(self) -> list[str]:
        return [m.capability for m in self.matches]
