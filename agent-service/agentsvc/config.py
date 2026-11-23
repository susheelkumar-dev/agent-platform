"""Settings: every value comes from an environment variable (or .env in development)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # Only the BFF knows this key. Without it every /api call is refused (fail closed).
    internal_api_key: SecretStr | None = None

    # Neon (or any PostgreSQL). Empty = in-memory checkpoints, allowed outside production only.
    database_url: str | None = None
    db_pool_max_size: int = 5

    # Free-tier LLM providers, tried in this order. A provider without a key is skipped.
    groq_api_key: SecretStr | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    google_api_key: SecretStr | None = None
    gemini_model: str = "gemini-2.5-flash"
    openrouter_api_key: SecretStr | None = None
    openrouter_model: str = "meta-llama/llama-3.3-70b-instruct:free"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_timeout_seconds: float = 45.0
    llm_max_retries: int = 1
    llm_temperature: float = 0.2

    # Optional LangSmith tracing
    langsmith_api_key: SecretStr | None = None
    langsmith_project: str = "agent-service"

    # The GridTrade demo API the data agent reads (and, after approval, writes)
    gridtrade_api_url: str = "http://127.0.0.1:5080/api"
    # needs trades.approve for the one write tool (always behind a human approval); reads need view rights only
    gridtrade_user: str = "ops.analyst"
    gridtrade_password: SecretStr | None = None
    gridtrade_timeout_seconds: float = 15.0

    # Limits
    max_message_chars: int = 4000
    recursion_limit: int = 16
    stream_keepalive_seconds: float = 15.0
    tool_output_chars: int = 6000

    # Bundled data for the migration analyst
    migration_report_path: str = Field(default="data/migration-report.json")

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def problems(self) -> list[str]:
        """Configuration that must stop a production start."""
        out: list[str] = []
        if not self.internal_api_key or len(self.internal_api_key.get_secret_value()) < 24:
            out.append("INTERNAL_API_KEY must be set (24+ characters)")
        if self.is_production and not self.database_url:
            out.append("DATABASE_URL is required in production (checkpoints must survive scale-to-zero)")
        if not any([self.groq_api_key, self.google_api_key, self.openrouter_api_key]):
            out.append("set at least one of GROQ_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY")
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
