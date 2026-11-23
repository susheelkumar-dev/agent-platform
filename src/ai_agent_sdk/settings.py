from __future__ import annotations

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from ai_core.config import DEV_REGISTRATION_TOKEN, DEV_SERVICE_TOKEN, DEV_SIGNING_SECRET


class AgentServiceSettings(BaseSettings):
    """Configuration of an agent microservice (env vars or .env)."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", populate_by_name=True
    )

    platform_url: str = Field(
        default="http://127.0.0.1:8000", validation_alias=AliasChoices("AGENT_PLATFORM_URL", "PLATFORM_URL")
    )
    service_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("AGENT_SERVICE_URL", "SERVICE_URL"),
        description="URL the platform uses to reach this service, e.g. http://inventory-agent:8080",
    )
    registration_token: str = Field(
        default=DEV_REGISTRATION_TOKEN,
        validation_alias=AliasChoices("AGENT_REGISTRATION_TOKEN", "REGISTRATION_TOKEN", "PLATFORM_REGISTRATION_TOKEN"),
    )
    service_token: str = Field(default=DEV_SERVICE_TOKEN, validation_alias=AliasChoices("AGENT_SERVICE_TOKEN"))
    signing_secret: str | None = Field(
        default=DEV_SIGNING_SECRET, validation_alias=AliasChoices("AGENT_SIGNING_SECRET", "SIGNING_SECRET")
    )
    require_signature: bool = Field(default=True, validation_alias=AliasChoices("AGENT_REQUIRE_SIGNATURE"))
    auto_register: bool = Field(default=True, validation_alias=AliasChoices("AGENT_AUTO_REGISTER"))
    heartbeat_interval_seconds: float = Field(
        default=20.0, validation_alias=AliasChoices("AGENT_HEARTBEAT_INTERVAL_SECONDS")
    )
    max_concurrency: int | None = Field(default=None, validation_alias=AliasChoices("AGENT_MAX_CONCURRENCY"))
    idempotency_cache_size: int = Field(default=2048, validation_alias=AliasChoices("AGENT_IDEMPOTENCY_CACHE_SIZE"))
    log_level: str = Field(default="INFO", validation_alias=AliasChoices("AGENT_LOG_LEVEL", "LOG_LEVEL"))
    log_format: str = Field(default="text", validation_alias=AliasChoices("AGENT_LOG_FORMAT", "LOG_FORMAT"))
