"""Provider-neutral LLM contracts (LLD §16)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class LLMMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class LLMRequest(BaseModel):
    messages: list[LLMMessage]
    system: str | None = None
    model: str | None = Field(default=None, description="Model name or alias; defaults to the platform model")
    temperature: float = Field(default=0.0, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=64_000)
    response_format: Literal["text", "json"] = "text"
    purpose: str = Field(default="general", description="router | planner | rag | compose | agent | general")
    prompt_name: str | None = None
    prompt_version: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LLMUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class LLMResponse(BaseModel):
    content: str
    provider: str
    model: str
    usage: LLMUsage = Field(default_factory=LLMUsage)
    cost_usd: float = 0.0
    latency_ms: float = 0.0
    finish_reason: str | None = None
    parsed: Any = None
    fallback_used: bool = False


class EmbeddingRequest(BaseModel):
    texts: list[str]
    model: str | None = None
    purpose: str = "rag"


class EmbeddingResponse(BaseModel):
    vectors: list[list[float]]
    provider: str
    model: str
    usage: LLMUsage = Field(default_factory=LLMUsage)
