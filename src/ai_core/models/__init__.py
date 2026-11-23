"""Public, versioned platform contracts.

Import from here (``from ai_core.models import AgentResult``) rather than the
sub-modules; the sub-module layout is an implementation detail.
"""

from ai_core.errors import ErrorCategory, ErrorInfo
from ai_core.models.agents import (
    MANIFEST_SCHEMA_VERSION,
    AgentHeartbeat,
    AgentManifest,
    AgentRecord,
    AgentRegistration,
    AgentStatus,
    AgentStatusUpdate,
    CapabilityInfo,
    CapabilitySpec,
    HealthStatus,
    RuntimeType,
)
from ai_core.models.artifacts import Artifact
from ai_core.models.common import has_permissions, missing_permissions, new_id, semver_key, utcnow
from ai_core.models.context import (
    AgentContext,
    AgentRequest,
    AgentResult,
    ChatRequest,
    Message,
    UserContext,
)
from ai_core.models.documents import (
    DocumentChunk,
    DocumentRef,
    DocumentStatus,
    RetrievalQuery,
    RetrievedChunk,
)
from ai_core.models.llm import (
    EmbeddingRequest,
    EmbeddingResponse,
    LLMMessage,
    LLMRequest,
    LLMResponse,
    LLMUsage,
)
from ai_core.models.plan import (
    CapabilityMatch,
    CapabilityResolution,
    ChatResponse,
    ExecutionPlan,
    ExecutionRecord,
    ExecutionStatus,
    PlanStep,
    PolicyDecision,
    RetryPolicy,
    StepRecord,
    StepStatus,
    TriggerRule,
    ValidatedPlan,
)

# v1 compatibility alias: the old starter called the manifest "AgentMetadata".
AgentMetadata = AgentManifest

__all__ = [
    "MANIFEST_SCHEMA_VERSION",
    "AgentContext",
    "AgentHeartbeat",
    "AgentManifest",
    "AgentMetadata",
    "AgentRecord",
    "AgentRegistration",
    "AgentRequest",
    "AgentResult",
    "AgentStatus",
    "AgentStatusUpdate",
    "Artifact",
    "CapabilityInfo",
    "CapabilityMatch",
    "CapabilityResolution",
    "CapabilitySpec",
    "ChatRequest",
    "ChatResponse",
    "DocumentChunk",
    "DocumentRef",
    "DocumentStatus",
    "EmbeddingRequest",
    "EmbeddingResponse",
    "ErrorCategory",
    "ErrorInfo",
    "ExecutionPlan",
    "ExecutionRecord",
    "ExecutionStatus",
    "HealthStatus",
    "LLMMessage",
    "LLMRequest",
    "LLMResponse",
    "LLMUsage",
    "Message",
    "PlanStep",
    "PolicyDecision",
    "RetrievalQuery",
    "RetrievedChunk",
    "RetryPolicy",
    "RuntimeType",
    "StepRecord",
    "StepStatus",
    "TriggerRule",
    "UserContext",
    "ValidatedPlan",
    "has_permissions",
    "missing_permissions",
    "new_id",
    "semver_key",
    "utcnow",
]
