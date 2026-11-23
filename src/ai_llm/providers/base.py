from __future__ import annotations

from typing import Protocol

from ai_core.errors import LLMError
from ai_core.models import EmbeddingResponse, LLMRequest, LLMResponse


class LLMProvider(Protocol):
    name: str
    supports_embeddings: bool

    async def generate(self, request: LLMRequest, model: str) -> LLMResponse: ...

    async def embed(self, texts: list[str], model: str) -> EmbeddingResponse: ...


def http_error(provider: str, status: int, body: str) -> LLMError:
    retryable = status == 429 or status >= 500
    return LLMError(
        f"{provider} returned HTTP {status}",
        code="LLM_HTTP_ERROR",
        retryable=retryable,
        details={"status": status, "body": body[:500]},
    )
