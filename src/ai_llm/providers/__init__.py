"""LLM provider adapters."""

from __future__ import annotations

from typing import Any

import httpx

from ai_core.config import Settings
from ai_llm.providers.anthropic import AnthropicProvider
from ai_llm.providers.base import LLMProvider
from ai_llm.providers.mock import MockProvider
from ai_llm.providers.openai_compat import OpenAICompatibleProvider

OPENAI_STYLE = {"openai", "azure_openai", "openai_compatible", "ollama", "vllm"}


def build_provider(name: str, settings: Settings, client: httpx.AsyncClient) -> LLMProvider:
    """Build a provider. The primary provider uses LLM_*; others use LLM_PROVIDERS[name]."""
    extra: dict[str, Any] = settings.llm_providers.get(name, {})
    primary = name == settings.llm_provider
    api_key = extra.get("api_key") or (
        settings.llm_api_key.get_secret_value() if primary and settings.llm_api_key else None
    )
    base_url = extra.get("base_url") or (settings.llm_base_url if primary else None)
    timeout = float(extra.get("timeout", settings.llm_timeout_seconds))
    if name == "mock":
        return MockProvider(settings.embedding_dimensions)
    if name == "anthropic":
        return AnthropicProvider(client, api_key=api_key, base_url=base_url, timeout=timeout)
    if name in OPENAI_STYLE:
        if name == "ollama" and not base_url:
            base_url = "http://localhost:11434/v1"
        return OpenAICompatibleProvider(
            client,
            name=name,
            base_url=base_url,
            api_key=api_key,
            api_version=extra.get("api_version") or (settings.llm_api_version if primary else None),
            timeout=timeout,
        )
    raise ValueError(f"Unknown LLM provider '{name}'. Known: mock, anthropic, {', '.join(sorted(OPENAI_STYLE))}")


__all__ = ["AnthropicProvider", "LLMProvider", "MockProvider", "OpenAICompatibleProvider", "build_provider"]
