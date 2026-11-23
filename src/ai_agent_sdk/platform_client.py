"""HTTP implementation of ``PlatformServices`` used inside agent microservices."""

from __future__ import annotations

from typing import Any

import httpx

from ai_core.errors import ErrorInfo, LLMError, PlatformError, RAGError
from ai_core.models import AgentContext, LLMMessage, LLMRequest, LLMResponse, RetrievalQuery, RetrievedChunk
from ai_security.signing import CONTEXT_HEADER


class HttpPlatformServices:
    def __init__(
        self, platform_url: str, registration_token: str, agent_id: str, client: httpx.AsyncClient
    ) -> None:
        self.platform_url = platform_url.rstrip("/")
        self.registration_token = registration_token
        self.agent_id = agent_id
        self.client = client

    def _headers(self, context: AgentContext) -> dict[str, str]:
        token = context.metadata.get("platform_context_token")
        if not token:
            raise PlatformError(
                "No platform context token on this request; platform services are only available while "
                "handling a platform-issued request.",
                code="NO_CONTEXT_TOKEN",
            )
        return {
            "Authorization": f"Bearer {self.registration_token}",
            CONTEXT_HEADER: token,
            "X-Agent-ID": self.agent_id,
            "X-Request-ID": context.request_id,
        }

    @staticmethod
    def _raise(response: httpx.Response, cls: type[PlatformError]) -> None:
        try:
            info = ErrorInfo.model_validate(response.json()["error"])
            raise cls(info.message, code=info.code, retryable=info.retryable, details=info.details)
        except (KeyError, ValueError):
            raise cls(f"Platform returned HTTP {response.status_code}", retryable=response.status_code >= 500)

    async def generate(
        self,
        context: AgentContext,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        system: str | None = None,
        response_format: str = "text",
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 1024,
        purpose: str = "agent",
        metadata: dict[str, Any] | None = None,
    ) -> LLMResponse:
        msgs = [LLMMessage(**m) for m in (messages or [])]
        if prompt:
            msgs.append(LLMMessage(role="user", content=prompt))
        body = LLMRequest(
            messages=msgs, system=system, model=model, temperature=temperature, max_tokens=max_tokens,
            response_format=response_format, purpose=purpose, metadata=metadata or {},  # type: ignore[arg-type]
        )
        try:
            response = await self.client.post(
                f"{self.platform_url}/api/v1/agent-services/llm/generate",
                json=body.model_dump(mode="json"),
                headers=self._headers(context),
                timeout=120,
            )
        except httpx.TransportError as exc:
            raise LLMError(f"Platform LLM gateway unreachable: {exc}", retryable=True) from exc
        if response.status_code != 200:
            self._raise(response, LLMError)
        return LLMResponse.model_validate(response.json())

    async def search(
        self,
        context: AgentContext,
        query: str,
        *,
        top_k: int = 5,
        document_ids: list[str] | None = None,
        knowledge_base: str | None = None,
    ) -> list[RetrievedChunk]:
        body = RetrievalQuery(query=query, top_k=top_k, document_ids=document_ids, knowledge_base=knowledge_base)
        try:
            response = await self.client.post(
                f"{self.platform_url}/api/v1/agent-services/rag/search",
                json=body.model_dump(mode="json"),
                headers=self._headers(context),
                timeout=60,
            )
        except httpx.TransportError as exc:
            raise RAGError(f"Platform retrieval unreachable: {exc}", retryable=True) from exc
        if response.status_code != 200:
            self._raise(response, RAGError)
        return [RetrievedChunk.model_validate(item) for item in response.json()]
