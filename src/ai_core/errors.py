"""Standard platform error model (LLD §24).

Every failure that crosses a component boundary is a ``PlatformError`` with a
category, a stable code, a retryable flag and structured details. The API maps
categories to HTTP status codes; the orchestrator uses ``retryable`` and
``category`` to drive retry policy.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ErrorCategory(StrEnum):
    VALIDATION = "VALIDATION"
    AUTHENTICATION = "AUTHENTICATION"
    AUTHORIZATION = "AUTHORIZATION"
    NOT_FOUND = "NOT_FOUND"
    REGISTRY = "REGISTRY"
    ROUTING = "ROUTING"
    EXECUTION = "EXECUTION"
    TIMEOUT = "TIMEOUT"
    AGENT_UNAVAILABLE = "AGENT_UNAVAILABLE"
    LLM = "LLM"
    RAG = "RAG"
    GUARDRAIL = "GUARDRAIL"
    RATE_LIMIT = "RATE_LIMIT"
    CANCELLED = "CANCELLED"
    INFRASTRUCTURE = "INFRASTRUCTURE"


HTTP_STATUS: dict[ErrorCategory, int] = {
    ErrorCategory.VALIDATION: 422,
    ErrorCategory.AUTHENTICATION: 401,
    ErrorCategory.AUTHORIZATION: 403,
    ErrorCategory.NOT_FOUND: 404,
    ErrorCategory.REGISTRY: 409,
    ErrorCategory.ROUTING: 422,
    ErrorCategory.EXECUTION: 502,
    ErrorCategory.TIMEOUT: 504,
    ErrorCategory.AGENT_UNAVAILABLE: 503,
    ErrorCategory.LLM: 502,
    ErrorCategory.RAG: 502,
    ErrorCategory.GUARDRAIL: 400,
    ErrorCategory.RATE_LIMIT: 429,
    ErrorCategory.CANCELLED: 409,
    ErrorCategory.INFRASTRUCTURE: 500,
}


class ErrorInfo(BaseModel):
    """Serializable error payload (used in AgentResult, StepRecord, API errors)."""

    code: str
    message: str
    category: ErrorCategory = ErrorCategory.EXECUTION
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)
    correlation_id: str | None = None


class PlatformError(Exception):
    category: ErrorCategory = ErrorCategory.EXECUTION
    default_code: str = "PLATFORM_ERROR"
    default_retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        category: ErrorCategory | None = None,
        retryable: bool | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code or self.default_code
        if category is not None:
            self.category = category
        self.retryable = self.default_retryable if retryable is None else retryable
        self.details = details or {}

    @property
    def http_status(self) -> int:
        return HTTP_STATUS.get(self.category, 500)

    def to_info(self, correlation_id: str | None = None) -> ErrorInfo:
        return ErrorInfo(
            code=self.code,
            message=self.message,
            category=self.category,
            retryable=self.retryable,
            details=self.details,
            correlation_id=correlation_id,
        )

    @classmethod
    def from_info(cls, info: ErrorInfo) -> PlatformError:
        return PlatformError(
            info.message,
            code=info.code,
            category=info.category,
            retryable=info.retryable,
            details=info.details,
        )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"{type(self).__name__}({self.code}: {self.message})"


class ValidationError(PlatformError):
    category = ErrorCategory.VALIDATION
    default_code = "VALIDATION_FAILED"


class AuthenticationError(PlatformError):
    category = ErrorCategory.AUTHENTICATION
    default_code = "UNAUTHENTICATED"


class AuthorizationError(PlatformError):
    category = ErrorCategory.AUTHORIZATION
    default_code = "FORBIDDEN"


class NotFoundError(PlatformError):
    category = ErrorCategory.NOT_FOUND
    default_code = "NOT_FOUND"


class RegistryError(PlatformError):
    category = ErrorCategory.REGISTRY
    default_code = "REGISTRY_ERROR"


class RoutingError(PlatformError):
    category = ErrorCategory.ROUTING
    default_code = "NO_ROUTE"


class AgentUnavailableError(PlatformError):
    category = ErrorCategory.AGENT_UNAVAILABLE
    default_code = "AGENT_UNAVAILABLE"
    default_retryable = True


class StepTimeoutError(PlatformError):
    category = ErrorCategory.TIMEOUT
    default_code = "STEP_TIMEOUT"
    default_retryable = True


class LLMError(PlatformError):
    category = ErrorCategory.LLM
    default_code = "LLM_ERROR"


class RAGError(PlatformError):
    category = ErrorCategory.RAG
    default_code = "RAG_ERROR"


class GuardrailViolation(PlatformError):
    category = ErrorCategory.GUARDRAIL
    default_code = "GUARDRAIL_BLOCKED"


class RateLimitError(PlatformError):
    category = ErrorCategory.RATE_LIMIT
    default_code = "RATE_LIMITED"
    default_retryable = True


class CancelledError(PlatformError):
    category = ErrorCategory.CANCELLED
    default_code = "CANCELLED"


class RetryableAgentError(PlatformError):
    """Raise from agent code to signal a transient failure the platform may retry."""

    category = ErrorCategory.EXECUTION
    default_code = "AGENT_TRANSIENT_ERROR"
    default_retryable = True
