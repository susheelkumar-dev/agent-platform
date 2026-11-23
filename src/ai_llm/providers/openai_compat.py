"""OpenAI-compatible Chat Completions adapter.

Covers OpenAI, Azure OpenAI (set ``LLM_API_VERSION``; the model name is the
deployment name), and any OpenAI-compatible server such as Ollama
(``http://localhost:11434/v1``), vLLM, LM Studio or an internal gateway.
"""

from __future__ import annotations

import httpx

from ai_core.errors import LLMError
from ai_core.models import EmbeddingResponse, LLMRequest, LLMResponse, LLMUsage
from ai_llm.providers.base import http_error


class OpenAICompatibleProvider:
    supports_embeddings = True

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        name: str = "openai",
        base_url: str | None = None,
        api_key: str | None = None,
        api_version: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.client = client
        self.name = name
        self.base_url = (base_url or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key
        self.api_version = api_version
        self.timeout = timeout

    def _url(self, model: str, path: str) -> tuple[str, dict[str, str], dict]:
        headers = {"Content-Type": "application/json"}
        params: dict = {}
        if self.api_version:  # Azure OpenAI
            url = f"{self.base_url}/openai/deployments/{model}/{path}"
            params["api-version"] = self.api_version
            if self.api_key:
                headers["api-key"] = self.api_key
        else:
            url = f"{self.base_url}/{path}"
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
        return url, headers, params

    async def generate(self, request: LLMRequest, model: str) -> LLMResponse:
        messages = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.extend(m.model_dump() for m in request.messages)
        body: dict = {
            "model": model,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
        if request.response_format == "json":
            body["response_format"] = {"type": "json_object"}
        url, headers, params = self._url(model, "chat/completions")
        try:
            response = await self.client.post(url, json=body, headers=headers, params=params, timeout=self.timeout)
        except httpx.TimeoutException as exc:
            raise LLMError(f"{self.name} timed out", code="LLM_TIMEOUT", retryable=True) from exc
        except httpx.TransportError as exc:
            raise LLMError(f"{self.name} unreachable: {exc}", code="LLM_UNREACHABLE", retryable=True) from exc
        if response.status_code >= 400:
            raise http_error(self.name, response.status_code, response.text)
        data = response.json()
        choice = (data.get("choices") or [{}])[0]
        usage = data.get("usage") or {}
        return LLMResponse(
            content=(choice.get("message") or {}).get("content") or "",
            provider=self.name,
            model=data.get("model", model),
            usage=LLMUsage(
                prompt_tokens=usage.get("prompt_tokens", 0), completion_tokens=usage.get("completion_tokens", 0)
            ),
            finish_reason=choice.get("finish_reason"),
        )

    async def embed(self, texts: list[str], model: str) -> EmbeddingResponse:
        url, headers, params = self._url(model, "embeddings")
        try:
            response = await self.client.post(
                url, json={"model": model, "input": texts}, headers=headers, params=params, timeout=self.timeout
            )
        except httpx.TransportError as exc:
            raise LLMError(f"{self.name} embeddings unreachable: {exc}", retryable=True) from exc
        if response.status_code >= 400:
            raise http_error(self.name, response.status_code, response.text)
        data = response.json()
        items = sorted(data.get("data", []), key=lambda d: d.get("index", 0))
        usage = data.get("usage") or {}
        return EmbeddingResponse(
            vectors=[d["embedding"] for d in items],
            provider=self.name,
            model=data.get("model", model),
            usage=LLMUsage(prompt_tokens=usage.get("prompt_tokens", 0)),
        )
