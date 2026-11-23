"""Platform configuration (12-factor: everything from env vars / .env).

Complex values (lists/dicts) are given as JSON, e.g.::

    AUTH_MODES='["jwt","static"]'
    TENANT_POLICIES='{"acme": {"deny_capabilities": ["trading.*"]}}'
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_REGISTRATION_TOKEN = "platform-demo-registration-token"
DEV_SERVICE_TOKEN = "agent-demo-service-token"
DEV_SIGNING_SECRET = "dev-signing-secret-change-me-0123456789"

DEMO_PERMISSIONS = [
    "inventory.read",
    "trading.exposure.read",
    "documents.read",
    "documents.write",
]


def _default_static_tokens() -> dict[str, dict[str, Any]]:
    return {
        "demo-user": {
            "user_id": "demo-user",
            "tenant_id": "demo-tenant",
            "display_name": "Demo Analyst",
            "roles": ["analyst"],
            "permissions": DEMO_PERMISSIONS,
        },
        "demo-viewer": {
            "user_id": "demo-viewer",
            "tenant_id": "demo-tenant",
            "display_name": "Demo Viewer (inventory only)",
            "roles": ["viewer"],
            "permissions": ["inventory.read", "documents.read"],
        },
        "demo-admin": {
            "user_id": "demo-admin",
            "tenant_id": "demo-tenant",
            "display_name": "Demo Platform Admin",
            "roles": ["platform-admin"],
            "permissions": [],
        },
        "acme-user": {
            "user_id": "acme-user",
            "tenant_id": "acme",
            "display_name": "ACME Analyst (second tenant)",
            "roles": ["analyst"],
            "permissions": DEMO_PERMISSIONS,
        },
    }


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", populate_by_name=True
    )

    # ---- general -----------------------------------------------------------
    app_name: str = "AI Agent Platform"
    environment: Literal["development", "test", "staging", "production"] = "development"
    public_url: str = Field(
        default="http://127.0.0.1:8000", validation_alias=AliasChoices("PUBLIC_URL", "PLATFORM_URL")
    )
    cors_origins: list[str] = Field(default_factory=list)
    serve_ui: bool = True

    # ---- storage -----------------------------------------------------------
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/platform.db",
        description="SQLAlchemy async URL, or 'memory' for non-persistent dev mode",
    )
    auto_create_schema: bool = True
    db_pool_size: int = 10

    # ---- authentication / authorization ---------------------------------------
    auth_modes: list[Literal["static", "jwt"]] = Field(default_factory=lambda: ["static"])
    static_tokens: dict[str, dict[str, Any]] = Field(default_factory=_default_static_tokens)
    jwt_secret: SecretStr | None = None
    jwt_jwks_url: str | None = None
    jwt_issuer: str | None = None
    jwt_audience: str | None = None
    jwt_algorithms: list[str] = Field(default_factory=lambda: ["RS256", "HS256"])
    jwt_user_claim: str = "sub"
    jwt_tenant_claim: str = "tid"
    jwt_roles_claim: str = "roles"
    jwt_permissions_claim: str = "permissions"
    jwt_name_claim: str = "name"
    default_tenant: str = "default"
    role_permissions: dict[str, list[str]] = Field(
        default_factory=lambda: {
            "platform-admin": ["*"],
            "analyst": ["documents.read", "documents.write"],
            "viewer": ["documents.read"],
        }
    )

    # ---- service-to-service --------------------------------------------------
    registration_token: SecretStr = Field(
        default=SecretStr(DEV_REGISTRATION_TOKEN),
        validation_alias=AliasChoices("REGISTRATION_TOKEN", "PLATFORM_REGISTRATION_TOKEN"),
    )
    agent_registration_tokens: dict[str, str] = Field(
        default_factory=dict, description="Optional per-agent registration tokens {agent_id: token}"
    )
    agent_service_token: SecretStr = Field(default=SecretStr(DEV_SERVICE_TOKEN))
    signing_secret: SecretStr = Field(default=SecretStr(DEV_SIGNING_SECRET))
    allowed_agent_hosts: list[str] = Field(
        default_factory=lambda: ["*"], description="Host globs agents may register from, e.g. ['*.agents.svc']"
    )
    context_token_ttl_seconds: int = 900

    # ---- policy / guardrails ---------------------------------------------------
    tenant_policies: dict[str, dict[str, Any]] = Field(default_factory=dict)
    guardrail_mode: Literal["off", "flag", "block"] = "flag"
    max_message_chars: int = 8000
    rate_limit_per_minute: int = 120
    rate_limit_burst: int = 30

    # ---- orchestration ----------------------------------------------------------
    engine: Literal["native", "langgraph"] = "native"
    resolver_mode: Literal["keyword", "llm", "hybrid"] = "hybrid"
    planner_mode: Literal["rule", "llm"] = "rule"
    max_plan_steps: int = 12
    max_parallel_steps: int = 8
    default_step_timeout_seconds: float = 30.0
    max_step_timeout_seconds: float = 600.0
    workflow_timeout_seconds: float = 180.0
    default_retry_attempts: int = 3
    retry_backoff_seconds: float = 0.5
    context_messages: int = 20
    compose_with_llm: bool = False

    # ---- registry health ----------------------------------------------------------
    enable_health_monitor: bool = True
    health_check_interval_seconds: float = 15.0
    health_check_timeout_seconds: float = 3.0
    unhealthy_after_failures: int = 3
    heartbeat_ttl_seconds: float = 60.0
    circuit_breaker_failures: int = 5
    circuit_breaker_reset_seconds: float = 30.0
    agent_http_timeout_seconds: float = 60.0
    agent_max_connections: int = 200

    # ---- LLM gateway ------------------------------------------------------------
    llm_provider: str = "mock"
    llm_model: str = Field(default="mock-1", validation_alias=AliasChoices("LLM_MODEL", "OPENAI_MODEL"))
    llm_base_url: str | None = None
    llm_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("LLM_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")
    )
    llm_api_version: str | None = Field(default=None, description="Azure OpenAI api-version")
    llm_fallbacks: list[str] = Field(default_factory=list, description="['provider:model', ...]")
    llm_providers: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description="Extra provider configs for fallbacks: {'anthropic': {'api_key': '...', 'base_url': '...'}}",
    )
    llm_model_aliases: dict[str, str] = Field(default_factory=dict)
    llm_pricing: dict[str, list[float]] = Field(
        default_factory=dict, description="{model: [usd_per_1k_input, usd_per_1k_output]}"
    )
    llm_timeout_seconds: float = 60.0
    llm_max_retries: int = 2
    embedding_provider: str | None = None
    embedding_model: str | None = None
    embedding_dimensions: int = 384

    # ---- RAG --------------------------------------------------------------------
    rag_chunk_size: int = 900
    rag_chunk_overlap: int = 150
    rag_top_k: int = 5
    max_upload_mb: int = 20

    # ---- observability -------------------------------------------------------------
    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "text"
    enable_metrics: bool = True
    otel_enabled: bool = False
    otel_service_name: str = "ai-agent-platform"

    # ---- helpers ----------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def uses_memory_storage(self) -> bool:
        return self.database_url.strip().lower() in {"memory", "inmemory", "in-memory", ""}

    def production_problems(self) -> list[str]:
        """Misconfigurations that are tolerated in dev but must block a production start."""
        problems: list[str] = []
        if self.registration_token.get_secret_value() == DEV_REGISTRATION_TOKEN:
            problems.append("REGISTRATION_TOKEN is the development default")
        if self.agent_service_token.get_secret_value() == DEV_SERVICE_TOKEN:
            problems.append("AGENT_SERVICE_TOKEN is the development default")
        if self.signing_secret.get_secret_value() == DEV_SIGNING_SECRET:
            problems.append("SIGNING_SECRET is the development default")
        if "static" in self.auth_modes and any(t.startswith(("demo-", "acme-")) for t in self.static_tokens):
            problems.append("STATIC_TOKENS still contains demo tokens")
        if self.uses_memory_storage or self.database_url.startswith("sqlite"):
            problems.append("DATABASE_URL must point to PostgreSQL in production")
        if "jwt" in self.auth_modes and not (self.jwt_jwks_url or self.jwt_secret):
            problems.append("AUTH_MODES includes jwt but neither JWT_JWKS_URL nor JWT_SECRET is set")
        if self.allowed_agent_hosts == ["*"]:
            problems.append("ALLOWED_AGENT_HOSTS should be restricted in production")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
