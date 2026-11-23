"""The BaseAgent contract every application agent implements (Arch §10, LLD §5).

An agent declares *what it can do* (capabilities + routing hints + permissions)
and implements ``execute``. Everything else — registration, discovery,
routing, planning, retries, security and telemetry — is supplied by the
platform. The same class runs in-process (``LocalAgentRuntime``) or as an
independent microservice (``ai_agent_sdk.create_agent_app``).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, ClassVar, Protocol

from pydantic import BaseModel

from ai_core.models import (
    AgentContext,
    AgentManifest,
    AgentRequest,
    AgentResult,
    CapabilitySpec,
    LLMResponse,
    RetrievedChunk,
)
from ai_tools.base import BaseTool, ToolBox

if TYPE_CHECKING:
    pass


class PlatformServices(Protocol):
    """Platform services an agent may use. Injected by the runtime.

    In-process agents get a direct implementation; remote agents get an HTTP
    implementation that calls back into the platform with a signed context
    token, so API keys and tenant data never live in the agent service.
    """

    async def generate(
        self,
        context: AgentContext,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        system: str | None = None,
        response_format: str = "text",
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 1024,
        purpose: str = "agent",
        metadata: dict[str, Any] | None = None,
    ) -> LLMResponse: ...

    async def search(
        self,
        context: AgentContext,
        query: str,
        *,
        top_k: int = 5,
        document_ids: list[str] | None = None,
        knowledge_base: str | None = None,
    ) -> list[RetrievedChunk]: ...


def capability(
    name: str,
    description: str = "",
    *,
    keywords: list[str] | None = None,
    examples: list[str] | None = None,
    permissions: list[str] | None = None,
    input_model: type[BaseModel] | None = None,
    output_model: type[BaseModel] | None = None,
    internal: bool = False,
) -> CapabilitySpec:
    """Convenience builder for capability declarations."""
    return CapabilitySpec(
        name=name,
        description=description,
        keywords=keywords or [],
        examples=examples or [],
        permissions=permissions or [],
        input_schema=input_model.model_json_schema() if input_model else None,
        output_schema=output_model.model_json_schema() if output_model else None,
        internal=internal,
    )


class BaseAgent(ABC):
    # ---- identity ---------------------------------------------------------------
    agent_id: ClassVar[str | None] = None  # defaults to ``name`` for v1 agents
    name: ClassVar[str]
    version: ClassVar[str] = "0.1.0"
    description: ClassVar[str] = ""

    # ---- declaration --------------------------------------------------------------
    capabilities: ClassVar[list[str | CapabilitySpec]] = []
    permissions: ClassVar[list[str]] = []
    tenants: ClassVar[list[str]] = ["*"]
    priority: ClassVar[int] = 100
    timeout_seconds: ClassVar[float] = 30.0
    idempotent: ClassVar[bool] = True
    max_concurrency: ClassVar[int | None] = None
    owner: ClassVar[str | None] = None
    tags: ClassVar[list[str]] = []

    # ---- injected ------------------------------------------------------------------
    platform: PlatformServices | None = None

    def __init__(self, tools: list[BaseTool] | None = None) -> None:
        declared = list(getattr(self, "tool_instances", []) or [])
        self.tools = ToolBox((tools or []) + declared)

    # ---- manifest ------------------------------------------------------------------
    def manifest(self) -> AgentManifest:
        caps = [c if isinstance(c, CapabilitySpec) else CapabilitySpec(name=c) for c in self.capabilities]
        return AgentManifest(
            agent_id=self.agent_id or self.name,
            name=self.name,
            version=self.version,
            description=self.description,
            capabilities=caps,
            permissions=list(self.permissions),
            tools=self.tools.names if hasattr(self, "tools") else [],
            tenants=list(self.tenants),
            priority=self.priority,
            timeout_seconds=self.timeout_seconds,
            idempotent=self.idempotent,
            max_concurrency=self.max_concurrency,
            owner=self.owner,
            tags=list(self.tags),
        )

    @property
    def id(self) -> str:
        return self.agent_id or self.name

    def input_model_for(self, capability_name: str) -> type[BaseModel] | None:
        """Override to return a Pydantic model used to validate input per capability."""
        return None

    # ---- lifecycle -------------------------------------------------------------------
    async def startup(self) -> None:  # noqa: B027 - optional hook
        """Open connections, warm caches. Called once before the first request."""

    async def shutdown(self) -> None:  # noqa: B027 - optional hook
        """Release resources. Called once on graceful shutdown."""

    async def ready(self) -> bool:
        """Readiness probe. Return False while dependencies are unavailable."""
        return True

    async def initialize(self, context: AgentContext) -> None:  # v1 compatibility hook
        return None

    # ---- behaviour ----------------------------------------------------------------------
    @abstractmethod
    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        raise NotImplementedError

    # ---- helpers ----------------------------------------------------------------------------
    def response(self, data: dict[str, Any] | None = None, **kwargs: Any) -> AgentResult:
        return AgentResult.success(data, **kwargs)
