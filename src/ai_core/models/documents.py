"""Document / RAG contracts (LLD §17-18)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from ai_core.models.common import new_id, utcnow


class DocumentStatus(StrEnum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class DocumentRef(BaseModel):
    document_id: str = Field(default_factory=lambda: new_id("doc"))
    tenant_id: str
    owner_id: str
    filename: str
    content_type: str = "application/octet-stream"
    size_bytes: int = 0
    status: DocumentStatus = DocumentStatus.PROCESSING
    chunk_count: int = 0
    knowledge_base: str = Field(default="default", description="Logical KB. 'conversation:<id>' for chat-scoped uploads")
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)


class DocumentChunk(BaseModel):
    chunk_id: str = Field(default_factory=lambda: new_id("chk"))
    document_id: str
    tenant_id: str
    knowledge_base: str = "default"
    ordinal: int
    text: str
    page: int | None = None
    embedding: list[float] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: str
    filename: str | None = None
    text: str
    page: int | None = None
    score: float
    vector_score: float = 0.0
    keyword_score: float = 0.0


class RetrievalQuery(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)
    document_ids: list[str] | None = None
    knowledge_base: str | None = None
    min_score: float = 0.0
