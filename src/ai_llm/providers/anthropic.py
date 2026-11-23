"""Anthropic Messages API adapter (``POST /v1/messages``)."""

from __future__ import annotations

import httpx

from ai_core.errors import LLMError
from ai_core.models import EmbeddingResponse, LLMRequest, LLMResponse, LLMUsage
from ai_llm.providers.base import http_error

ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider:
    name = "anthropic"
    supports_embeddings = False

    def __init__(
        self, client: httpx.AsyncClient, *, api_key: str | None, base_url: str | None = None, timeout: float = 60.0
    ) -> None:
        self.client = client
        self.api_key = api_key
        self.base_url = (base_url or "https://api.anthropic.com").rstrip("/")
        self.timeout = timeout

    async def generate(self, request: LLMRequest, model: str) -> LLMResponse:
        system = request.system or ""
        if request.response_format == "json":
            system = (system + "\n\nRespond with a single valid JSON object and nothing else.").strip()
        body: dict = {
            "model": model,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "messages": [m.model_dump() for m in request.messages if m.role != "system"],
        }
        if system:
            body["system"] = system
        headers = {
            "x-api-key": self.api_key or "",
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        try:
            response = await self.client.post(
                f"{self.base_url}/v1/messages", json=body, headers=headers, timeout=self.timeout
            )
        except httpx.TimeoutException as exc:
            raise LLMError("anthropic timed out", code="LLM_TIMEOUT", retryable=True) from exc
        except httpx.TransportError as exc:
            raise LLMError(f"anthropic unreachable: {exc}", code="LLM_UNREACHABLE", retryable=True) from exc
        if response.status_code >= 400:
            raise http_error(self.name, response.status_code, response.text)
        data = response.json()
        text = "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
        usage = data.get("usage") or {}
        return LLMResponse(
            content=text,
            provider=self.name,
            model=data.get("model", model),
            usage=LLMUsage(
                prompt_tokens=usage.get("input_tokens", 0), completion_tokens=usage.get("output_tokens", 0)
            ),
            finish_reason=data.get("stop_reason"),
        )

    async def embed(self, texts: list[str], model: str) -> EmbeddingResponse:
        raise LLMError("Anthropic does not provide an embeddings API; set EMBEDDING_PROVIDER", code="NO_EMBEDDINGS")
