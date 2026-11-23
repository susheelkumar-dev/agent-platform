"""Provider-neutral LLM Gateway (Arch §16, LLD §16, Gap G13).

Responsibilities: model aliasing and routing, ordered provider fallback,
retry with backoff on transient errors, timeouts, JSON-output parsing,
token/cost accounting, usage persistence and metrics. Agents never talk to a
provider SDK directly — in-process agents call this class, remote agents call
``POST /api/v1/llm/generate``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

import httpx

from ai_core.config import Settings
from ai_core.errors import LLMError
from ai_core.interfaces import UsageStore
from ai_core.models import EmbeddingRequest, EmbeddingResponse, LLMMessage, LLMRequest, LLMResponse
from ai_core.models.ops import UsageRecord
from ai_llm.providers import LLMProvider, MockProvider, build_provider
from ai_observability.tracing import span

logger = logging.getLogger("ai_llm")

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_json_content(content: str) -> Any:
    text = _FENCE.sub("", content.strip()).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


class LLMGateway:
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient,
        *,
        usage_store: UsageStore | None = None,
        metrics: Any = None,
        providers: dict[str, LLMProvider] | None = None,
    ) -> None:
        self.settings = settings
        self.client = client
        self.usage_store = usage_store
        self.metrics = metrics
        self._providers: dict[str, LLMProvider] = dict(providers or {})

    # ---- routing --------------------------------------------------------------------
    def provider(self, name: str) -> LLMProvider:
        if name not in self._providers:
            self._providers[name] = build_provider(name, self.settings, self.client)
        return self._providers[name]

    def route(self, model: str | None) -> list[tuple[str, str]]:
        s = self.settings
        requested = s.llm_model_aliases.get(model or "", model) if model else None
        chain: list[tuple[str, str]] = []
        if requested and ":" in requested:
            prov, mdl = requested.split(":", 1)
            chain.append((prov, mdl))
        else:
            chain.append((s.llm_provider, requested or s.llm_model))
        for item in s.llm_fallbacks:
            prov, _, mdl = item.partition(":")
            if (prov, mdl) not in chain:
                chain.append((prov, mdl or s.llm_model))
        return chain

    @property
    def is_mock(self) -> bool:
        return self.settings.llm_provider == "mock"

    def estimate_cost(self, model: str, prompt_tokens: int, completion_tokens: int) -> float:
        price = self.settings.llm_pricing.get(model)
        if not price:
            return 0.0
        return round(prompt_tokens / 1000 * price[0] + completion_tokens / 1000 * price[1], 6)

    # ---- generation ------------------------------------------------------------------
    async def generate(
        self,
        request: LLMRequest,
        *,
        tenant_id: str | None = None,
        user_id: str | None = None,
        agent_id: str | None = None,
        request_id: str | None = None,
        execution_id: str | None = None,
    ) -> LLMResponse:
        chain = self.route(request.model)
        last_error: LLMError | None = None
        for index, (provider_name, model) in enumerate(chain):
            provider = self.provider(provider_name)
            for attempt in range(self.settings.llm_max_retries + 1):
                start = time.perf_counter()
                try:
                    with span("llm.generate", provider=provider_name, model=model, purpose=request.purpose):
                        response = await provider.generate(request, model)
                    response.latency_ms = round((time.perf_counter() - start) * 1000, 1)
                    response.cost_usd = self.estimate_cost(
                        model, response.usage.prompt_tokens, response.usage.completion_tokens
                    )
                    response.fallback_used = index > 0
                    if request.response_format == "json":
                        try:
                            response.parsed = parse_json_content(response.content)
                        except (json.JSONDecodeError, ValueError) as exc:
                            raise LLMError(
                                "Model did not return valid JSON", code="LLM_BAD_JSON", retryable=True
                            ) from exc
                    await self._record(
                        response, request.purpose, True, tenant_id, user_id, agent_id, request_id, execution_id
                    )
                    return response
                except LLMError as exc:
                    last_error = exc
                    self._count(provider_name, model, "error")
                    logger.warning(
                        "llm_error provider=%s model=%s attempt=%s code=%s retryable=%s",
                        provider_name, model, attempt + 1, exc.code, exc.retryable,
                    )
                    if not exc.retryable or attempt >= self.settings.llm_max_retries:
                        break
                    await asyncio.sleep(min(0.5 * 2**attempt, 8))
        raise last_error or LLMError("No LLM provider configured")

    async def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        purpose: str = "general",
        response_format: str = "text",
        **kwargs: Any,
    ) -> LLMResponse:
        return await self.generate(
            LLMRequest(
                messages=[LLMMessage(role="user", content=prompt)],
                system=system,
                purpose=purpose,
                response_format=response_format,
                metadata=kwargs.pop("metadata", {}),
            ),
            **kwargs,
        )

    # ---- embeddings ---------------------------------------------------------------------
    async def embed(self, request: EmbeddingRequest, *, tenant_id: str | None = None) -> EmbeddingResponse:
        s = self.settings
        provider_name = s.embedding_provider or s.llm_provider
        provider = self.provider(provider_name)
        if not provider.supports_embeddings:
            logger.warning("provider %s has no embeddings; using hashing embeddings", provider_name)
            provider = MockProvider(s.embedding_dimensions)
        model = request.model or s.embedding_model or s.llm_model
        start = time.perf_counter()
        response = await provider.embed(request.texts, model)
        if self.metrics is not None:
            self.metrics.llm_tokens.inc(
                response.usage.prompt_tokens, provider=response.provider, model=response.model, type="embedding"
            )
            self.metrics.llm_latency.observe(time.perf_counter() - start, provider=response.provider, kind="embed")
        return response

    # ---- accounting ------------------------------------------------------------------------
    def _count(self, provider: str, model: str, outcome: str) -> None:
        if self.metrics is not None:
            self.metrics.llm_requests.inc(provider=provider, model=model, outcome=outcome)

    async def _record(
        self,
        response: LLMResponse,
        purpose: str,
        success: bool,
        tenant_id: str | None,
        user_id: str | None,
        agent_id: str | None,
        request_id: str | None,
        execution_id: str | None,
    ) -> None:
        if self.metrics is not None:
            labels = {"provider": response.provider, "model": response.model}
            self._count(response.provider, response.model, "success")
            self.metrics.llm_tokens.inc(response.usage.prompt_tokens, type="prompt", **labels)
            self.metrics.llm_tokens.inc(response.usage.completion_tokens, type="completion", **labels)
            self.metrics.llm_cost.inc(response.cost_usd, **labels)
            self.metrics.llm_latency.observe(response.latency_ms / 1000, provider=response.provider, kind="generate")
        if self.usage_store is not None:
            try:
                await self.usage_store.record(
                    UsageRecord(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        agent_id=agent_id,
                        request_id=request_id,
                        execution_id=execution_id,
                        provider=response.provider,
                        model=response.model,
                        purpose=purpose,
                        prompt_tokens=response.usage.prompt_tokens,
                        completion_tokens=response.usage.completion_tokens,
                        cost_usd=response.cost_usd,
                        latency_ms=response.latency_ms,
                        success=success,
                    )
                )
            except Exception:
                logger.exception("failed to record LLM usage")
