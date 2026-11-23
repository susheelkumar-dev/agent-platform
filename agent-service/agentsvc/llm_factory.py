"""Zero-cost multi-provider chat model: Groq -> Google AI Studio (Gemini) -> OpenRouter ``:free``.

Tools are bound to *each* provider before ``with_fallbacks`` (a fallback wrapper cannot bind tools itself), so a
failover keeps tool calling. Only remote APIs are used: no torch, no local embeddings, small container.
Providers are imported lazily so a missing key never costs import time or memory.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable

from .config import Settings

logger = logging.getLogger("agentsvc.llm")

_override: Runnable | None = None  # tests inject a fake model here


def set_model_override(model: Runnable | None) -> None:
    global _override
    _override = model


def _providers(s: Settings) -> list[tuple[str, BaseChatModel]]:
    out: list[tuple[str, BaseChatModel]] = []
    common: dict[str, Any] = {"temperature": s.llm_temperature, "max_retries": s.llm_max_retries}
    if s.groq_api_key:
        from langchain_groq import ChatGroq

        out.append(("groq", ChatGroq(model=s.groq_model, api_key=s.groq_api_key, timeout=s.llm_timeout_seconds,
                                     streaming=True, **common)))
    if s.google_api_key:
        from langchain_google_genai import ChatGoogleGenerativeAI

        out.append(("gemini", ChatGoogleGenerativeAI(model=s.gemini_model, google_api_key=s.google_api_key,
                                                     timeout=s.llm_timeout_seconds, **common)))
    if s.openrouter_api_key:
        from langchain_openai import ChatOpenAI

        out.append(("openrouter", ChatOpenAI(model=s.openrouter_model, api_key=s.openrouter_api_key,
                                             base_url=s.openrouter_base_url, timeout=s.llm_timeout_seconds,
                                             streaming=True, **common)))
    return out


def configured_providers(s: Settings) -> list[str]:
    return [name for name, _ in _providers(s)] if _override is None else ["override"]


def chat_model(s: Settings, tools: Sequence[Any] | None = None) -> Runnable:
    """The primary model with ordered fallbacks; tools (if any) bound on every provider."""
    if _override is not None:
        return _override.bind_tools(list(tools)) if tools and hasattr(_override, "bind_tools") else _override
    models = _providers(s)
    if not models:
        raise RuntimeError("No LLM provider configured: set GROQ_API_KEY, GOOGLE_API_KEY or OPENROUTER_API_KEY")
    bound: list[Runnable] = [m.bind_tools(list(tools)) if tools else m for _, m in models]
    primary, fallbacks = bound[0], bound[1:]
    logger.debug("llm chain: %s", " -> ".join(n for n, _ in models))
    return primary.with_fallbacks(fallbacks) if fallbacks else primary
