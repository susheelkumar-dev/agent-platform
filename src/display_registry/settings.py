"""Registry configuration (environment variables or .env).

    DATABASE_URL                     the platform's database (shared); default sqlite ./data/platform.db
    DISPLAY_REGISTRY_APPS_FILE       JSON file describing the applications served (see AppConfig)
    DISPLAY_REGISTRY_APPS            the same JSON inline (wins over the file)
    DISPLAY_REGISTRY_HOST / _PORT    bind address, default 127.0.0.1:8130
    DISPLAY_REGISTRY_CORS_ORIGINS    comma-separated origins, only when the UI calls the registry cross-origin

Each application keeps its own identity provider and permissions: the registry validates the application's
tokens and asks the application which permissions exist. It never stores users or roles.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .manifest import BUILTIN_DISPLAY_TYPES


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    title: str = ""
    issuer: str
    audience: str
    algorithms: list[str] = Field(default_factory=lambda: ["HS256"])
    secret_env: str | None = Field(default=None, alias="secretEnv", description="Env var holding the HS256 secret")
    jwks_url: str | None = Field(default=None, alias="jwksUrl")
    user_claim: str = Field(default="sub", alias="userClaim")
    permissions_claim: str = Field(default="permissions", alias="permissionsClaim")
    permission_catalog_url: str | None = Field(default=None, alias="permissionCatalogUrl")
    register_permission: str = Field(default="displays.register", alias="registerPermission")
    admin_permission: str = Field(default="displays.register", alias="adminPermission")
    display_types: list[str] = Field(default_factory=lambda: list(BUILTIN_DISPLAY_TYPES), alias="displayTypes")

    @model_validator(mode="after")
    def _key_source(self) -> AppConfig:
        if not (self.secret_env or self.jwks_url):
            raise ValueError("each app needs secretEnv (HS256) or jwksUrl (RS256)")
        return self

    def secret(self) -> str | None:
        return os.environ.get(self.secret_env) if self.secret_env else None


class RegistrySettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore", populate_by_name=True)

    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/platform.db",
        validation_alias=AliasChoices("DISPLAY_REGISTRY_DATABASE_URL", "DATABASE_URL"),
    )
    auto_create_schema: bool = Field(default=True, validation_alias=AliasChoices("DISPLAY_REGISTRY_AUTO_CREATE_SCHEMA", "AUTO_CREATE_SCHEMA"))
    apps_json: str | None = Field(default=None, validation_alias=AliasChoices("DISPLAY_REGISTRY_APPS"))
    apps_file: str | None = Field(default=None, validation_alias=AliasChoices("DISPLAY_REGISTRY_APPS_FILE"))
    host: str = Field(default="127.0.0.1", validation_alias=AliasChoices("DISPLAY_REGISTRY_HOST"))
    port: int = Field(default=8130, validation_alias=AliasChoices("DISPLAY_REGISTRY_PORT"))
    cors_origins: str = Field(default="", validation_alias=AliasChoices("DISPLAY_REGISTRY_CORS_ORIGINS"))
    catalog_cache_seconds: float = Field(default=60.0, validation_alias=AliasChoices("DISPLAY_REGISTRY_CATALOG_CACHE_SECONDS"))
    http_timeout_seconds: float = Field(default=5.0, validation_alias=AliasChoices("DISPLAY_REGISTRY_HTTP_TIMEOUT_SECONDS"))

    def apps(self) -> dict[str, AppConfig]:
        raw: dict = {}
        if self.apps_json:
            raw = json.loads(self.apps_json)
        elif self.apps_file:
            raw = json.loads(Path(self.apps_file).read_text(encoding="utf-8"))
        return {app_id: AppConfig.model_validate(cfg) for app_id, cfg in raw.items()}


@lru_cache
def get_settings() -> RegistrySettings:
    return RegistrySettings()
