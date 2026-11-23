"""Request, identity and execution-context contracts (LLD §4)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from ai_core.errors import ErrorInfo
from ai_core.models.common import new_id, utcnow


class UserContext(BaseModel):
    """Authenticated principal. Always produced by the platform, never by the client."""

    user_id: str
    tenant_id: str
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    display_name: str | None = None
    auth_method: str = "unknown"

    @property
    def is_admin(self) -> bool:
        from ai_core.models.common import has_permissions

        return has_permissions(self.permissions, ["platform.admin"])


class Message(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)


class ChatRequest(BaseModel):
    request_id: str = Field(default_factory=new_id)
    conversation_id: str = Field(default_factory=new_id)
    message: str = Field(min_length=1)
    attachments: list[str] = Field(default_factory=list, description="Document IDs to ground this request on")
    capabilities: list[str] | None = Field(
        default=None,
        description="Optional explicit capabilities. Lets an existing application bypass free-text routing.",
    )
    variables: dict[str, Any] = Field(default_factory=dict, description="Structured input passed to every step")
    metadata: dict[str, Any] = Field(default_factory=dict)
    mode: Literal["sync", "async"] = "sync"


class AgentContext(BaseModel):
    request_id: str
    execution_id: str
    conversation_id: str
    user: UserContext
    messages: list[dict[str, Any]] = Field(default_factory=list)
    variables: dict[str, Any] = Field(default_factory=dict)
    memory_refs: list[str] = Field(default_factory=list)
    knowledge_contexts: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def tenant_id(self) -> str:
        return self.user.tenant_id


class AgentRequest(BaseModel):
    request_id: str
    agent_id: str
    agent_version: str | None = None
    capability: str | None = None
    step_id: str | None = None
    input: dict[str, Any] = Field(default_factory=dict)
    context: AgentContext
    previous_results: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None
    attempt: int = 1
    deadline_seconds: float | None = None
    context_token: str | None = Field(
        default=None,
        description="Short-lived platform-signed token. Agents pass it back when calling platform services (LLM, RAG).",
    )


class AgentResult(BaseModel):
    status: Literal["success", "error", "partial"] = "success"
    output: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    usage: dict[str, Any] = Field(default_factory=dict)
    error: ErrorInfo | None = None

    @classmethod
    def success(
        cls,
        output: dict[str, Any] | None = None,
        *,
        summary: str | None = None,
        artifacts: list[dict[str, Any]] | None = None,
        citations: list[dict[str, Any]] | None = None,
        **metadata: Any,
    ) -> AgentResult:
        out = dict(output or {})
        if summary is not None:
            out["summary"] = summary
        return cls(output=out, artifacts=artifacts or [], citations=citations or [], metadata=metadata)

    @classmethod
    def failure(
        cls,
        message: str,
        *,
        code: str = "AGENT_ERROR",
        retryable: bool = False,
        category: str = "EXECUTION",
        details: dict[str, Any] | None = None,
    ) -> AgentResult:
        return cls(
            status="error",
            error=ErrorInfo(
                code=code, message=message, retryable=retryable, category=category, details=details or {}
            ),
        )

    @property
    def summary(self) -> str | None:
        value = self.output.get("summary")
        return str(value) if value is not None else None
