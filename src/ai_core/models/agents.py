"""Agent manifest, registry record and capability contracts (Arch §11-12, LLD §6-7)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ai_core.models.common import AGENT_ID_RE, CAPABILITY_RE, SEMVER_RE, utcnow

MANIFEST_SCHEMA_VERSION = "2"


class RuntimeType(StrEnum):
    LOCAL = "local"
    REMOTE_HTTP = "remote_http"


class AgentStatus(StrEnum):
    """Administrative lifecycle (LLD §32). Controlled by registration + admins."""

    REGISTERED = "registered"
    ACTIVE = "active"
    DISABLED = "disabled"
    DEPRECATED = "deprecated"
    RETIRED = "retired"


class HealthStatus(StrEnum):
    """Operational health. Controlled by heartbeats and the health monitor."""

    UNKNOWN = "unknown"
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    OFFLINE = "offline"


ROUTABLE_STATUSES = {AgentStatus.ACTIVE}
ROUTABLE_HEALTH = {HealthStatus.HEALTHY, HealthStatus.DEGRADED, HealthStatus.UNKNOWN}
STICKY_ADMIN_STATUSES = {AgentStatus.DISABLED, AgentStatus.DEPRECATED, AgentStatus.RETIRED}


class CapabilitySpec(BaseModel):
    """A stable semantic contract an agent implements.

    ``keywords`` and ``examples`` are routing hints owned by the agent team. The
    platform resolver uses them so that *no domain vocabulary lives in platform
    code*.
    """

    name: str
    description: str = ""
    keywords: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    input_schema: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None
    internal: bool = Field(
        default=False,
        description="Internal capabilities are only used by the planner, never matched from user text.",
    )

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        if not CAPABILITY_RE.match(value):
            raise ValueError(
                f"Invalid capability name '{value}'. Use lower-case dotted names, e.g. 'inventory.valuation.read'."
            )
        return value

    @field_validator("keywords")
    @classmethod
    def _normalize_keywords(cls, value: list[str]) -> list[str]:
        return sorted({k.strip().lower() for k in value if k and k.strip()})


class AgentManifest(BaseModel):
    """What an agent service publishes at ``GET /api/v1/manifest``."""

    model_config = ConfigDict(extra="ignore")

    schema_version: str = MANIFEST_SCHEMA_VERSION
    agent_id: str
    name: str
    version: str
    description: str = ""
    capabilities: list[CapabilitySpec]
    permissions: list[str] = Field(default_factory=list, description="Required to invoke any capability")
    tools: list[str] = Field(default_factory=list)
    tenants: list[str] = Field(default_factory=lambda: ["*"])
    priority: int = Field(default=100, ge=0, le=10_000)
    timeout_seconds: float = Field(default=30.0, gt=0, le=3600)
    idempotent: bool = Field(default=True, description="Safe to retry with the same idempotency key")
    max_concurrency: int | None = Field(default=None, ge=1)
    owner: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _backward_compatible(cls, data: Any) -> Any:
        # v1 manifests used a plain list[str] for capabilities and no explicit agent_id.
        if isinstance(data, dict):
            data = dict(data)
            caps = data.get("capabilities") or []
            data["capabilities"] = [{"name": c} if isinstance(c, str) else c for c in caps]
            if not data.get("agent_id") and data.get("name"):
                data["agent_id"] = data["name"]
            data.setdefault("name", data.get("agent_id"))
        return data

    @field_validator("agent_id")
    @classmethod
    def _valid_agent_id(cls, value: str) -> str:
        if not AGENT_ID_RE.match(value):
            raise ValueError(f"Invalid agent_id '{value}'. Use lower-case kebab case, e.g. 'inventory-agent'.")
        return value

    @field_validator("version")
    @classmethod
    def _valid_version(cls, value: str) -> str:
        if not SEMVER_RE.match(value):
            raise ValueError(f"Invalid version '{value}'. Use semantic versioning, e.g. '1.2.0'.")
        return value

    @field_validator("capabilities")
    @classmethod
    def _non_empty(cls, value: list[CapabilitySpec]) -> list[CapabilitySpec]:
        if not value:
            raise ValueError("An agent must declare at least one capability")
        names = [c.name for c in value]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate capability names in manifest")
        return value

    @property
    def capability_names(self) -> list[str]:
        return [c.name for c in self.capabilities]

    def capability(self, name: str) -> CapabilitySpec | None:
        return next((c for c in self.capabilities if c.name == name), None)

    def allows_tenant(self, tenant_id: str) -> bool:
        return "*" in self.tenants or tenant_id in self.tenants


class AgentRecord(BaseModel):
    """Registry entry: manifest + platform-owned operational state."""

    manifest: AgentManifest
    runtime_type: RuntimeType = RuntimeType.REMOTE_HTTP
    service_url: str | None = None
    status: AgentStatus = AgentStatus.ACTIVE
    health: HealthStatus = HealthStatus.UNKNOWN
    health_detail: str | None = None
    consecutive_failures: int = 0
    registered_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    last_seen_at: datetime | None = None
    last_health_check_at: datetime | None = None

    @property
    def agent_id(self) -> str:
        return self.manifest.agent_id

    @property
    def version(self) -> str:
        return self.manifest.version

    @property
    def key(self) -> tuple[str, str]:
        return (self.manifest.agent_id, self.manifest.version)

    @property
    def routable(self) -> bool:
        return self.status in ROUTABLE_STATUSES and self.health in ROUTABLE_HEALTH

    def public_view(self) -> dict[str, Any]:
        data = self.model_dump(mode="json")
        data.update(
            agent_id=self.agent_id,
            version=self.version,
            name=self.manifest.name,
            description=self.manifest.description,
            capabilities=self.manifest.capability_names,
            permissions=self.manifest.permissions,
            routable=self.routable,
        )
        return data


class CapabilityInfo(BaseModel):
    """Aggregated catalog view of one capability across registered agents."""

    name: str
    description: str = ""
    keywords: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    internal: bool = False
    agents: list[str] = Field(default_factory=list)
    routable: bool = False


class AgentRegistration(BaseModel):
    """Body of ``POST /api/v1/agent-services/register``."""

    manifest: AgentManifest
    service_url: str
    registration_token: str | None = None


class AgentHeartbeat(BaseModel):
    agent_id: str
    version: str
    service_url: str | None = None
    registration_token: str | None = None
    health: HealthStatus = HealthStatus.HEALTHY
    detail: str | None = None


class AgentStatusUpdate(BaseModel):
    status: AgentStatus
    reason: str | None = None
