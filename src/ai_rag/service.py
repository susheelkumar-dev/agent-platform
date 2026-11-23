"""RAG service: ingestion pipeline + hybrid retrieval (Arch §13-14, LLD §17-18).

Ingestion: parse → chunk → embed → store, tenant-scoped, with per-document
status. Retrieval: dense (cosine) + lexical (BM25-style) scores fused, then a
pluggable reranker. Every retrieved chunk carries document/page metadata so
answers can cite sources.
"""

from __future__ import annotations

import asyncio
import logging
import math
from collections import Counter
from typing import Protocol

from ai_core.config import Settings
from ai_core.errors import NotFoundError, RAGError
from ai_core.events import EventBus, EventType, PlatformEvent
from ai_core.interfaces import DocumentStore, VectorStore
from ai_core.models import (
    DocumentChunk,
    DocumentRef,
    DocumentStatus,
    EmbeddingRequest,
    RetrievalQuery,
    RetrievedChunk,
    UserContext,
)
from ai_llm.gateway import LLMGateway
from ai_llm.providers.mock import tokens
from ai_rag.chunking import chunk_text
from ai_rag.parsing import parse_document

logger = logging.getLogger("ai_rag")


class Reranker(Protocol):
    def rerank(self, query: str, items: list[RetrievedChunk]) -> list[RetrievedChunk]: ...


class LexicalCoverageReranker:
    """Boosts chunks that cover more distinct query terms. Swap for a cross-encoder in production."""

    def rerank(self, query: str, items: list[RetrievedChunk]) -> list[RetrievedChunk]:
        q = set(tokens(query))
        if not q:
            return items
        for item in items:
            coverage = len(q & set(tokens(item.text))) / len(q)
            item.score = round(0.8 * item.score + 0.2 * coverage, 6)
        return sorted(items, key=lambda i: -i.score)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _bm25(query_terms: list[str], docs: list[list[str]], k1: float = 1.4, b: float = 0.75) -> list[float]:
    if not docs:
        return []
    n = len(docs)
    avgdl = sum(len(d) for d in docs) / n or 1.0
    df = Counter(t for d in docs for t in set(d))
    scores = []
    for d in docs:
        tf = Counter(d)
        score = 0.0
        for t in set(query_terms):
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / avgdl))
        scores.append(score)
    top = max(scores) or 1.0
    return [s / top for s in scores]


class RAGService:
    def __init__(
        self,
        settings: Settings,
        documents: DocumentStore,
        vectors: VectorStore,
        llm: LLMGateway,
        *,
        bus: EventBus | None = None,
        reranker: Reranker | None = None,
    ) -> None:
        self.settings = settings
        self.documents = documents
        self.vectors = vectors
        self.llm = llm
        self.bus = bus
        self.reranker = reranker or LexicalCoverageReranker()
        self._tasks: set[asyncio.Task] = set()

    # ---- ingestion ---------------------------------------------------------------------
    async def ingest(
        self,
        user: UserContext,
        filename: str,
        data: bytes,
        *,
        content_type: str = "application/octet-stream",
        knowledge_base: str = "default",
        wait: bool = True,
    ) -> DocumentRef:
        max_bytes = self.settings.max_upload_mb * 1024 * 1024
        if len(data) > max_bytes:
            raise RAGError(f"File exceeds {self.settings.max_upload_mb} MB", code="FILE_TOO_LARGE")
        doc = DocumentRef(
            tenant_id=user.tenant_id,
            owner_id=user.user_id,
            filename=filename,
            content_type=content_type,
            size_bytes=len(data),
            knowledge_base=knowledge_base,
        )
        await self.documents.save(doc)
        await self._emit(EventType.DOCUMENT_INGESTION_STARTED, doc, user)
        if wait:
            return await self._process(doc, data, user)
        task = asyncio.create_task(self._process(doc, data, user))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return doc

    async def _process(self, doc: DocumentRef, data: bytes, user: UserContext) -> DocumentRef:
        try:
            sections = parse_document(doc.filename, data)
            chunks: list[DocumentChunk] = []
            for page, text in sections:
                for piece in chunk_text(
                    text, size=self.settings.rag_chunk_size, overlap=self.settings.rag_chunk_overlap
                ):
                    chunks.append(
                        DocumentChunk(
                            document_id=doc.document_id,
                            tenant_id=doc.tenant_id,
                            knowledge_base=doc.knowledge_base,
                            ordinal=len(chunks),
                            text=piece,
                            page=page,
                            metadata={"filename": doc.filename},
                        )
                    )
            for start in range(0, len(chunks), 64):
                batch = chunks[start : start + 64]
                emb = await self.llm.embed(EmbeddingRequest(texts=[c.text for c in batch]), tenant_id=doc.tenant_id)
                for chunk, vector in zip(batch, emb.vectors, strict=True):
                    chunk.embedding = vector
            await self.vectors.add(chunks)
            doc.status = DocumentStatus.READY
            doc.chunk_count = len(chunks)
            await self.documents.save(doc)
            await self._emit(EventType.DOCUMENT_INGESTION_COMPLETED, doc, user, chunks=len(chunks))
        except Exception as exc:
            logger.exception("ingestion failed for %s", doc.document_id)
            doc.status = DocumentStatus.FAILED
            doc.error = str(exc)[:1000]
            await self.documents.save(doc)
            await self._emit(EventType.DOCUMENT_INGESTION_FAILED, doc, user, error=doc.error)
            if isinstance(exc, RAGError):
                raise
            raise RAGError(f"Ingestion failed: {exc}") from exc
        return doc

    async def _emit(self, event_type: str, doc: DocumentRef, user: UserContext, **payload) -> None:
        if self.bus:
            await self.bus.publish(
                PlatformEvent(
                    event_type=event_type,
                    tenant_id=doc.tenant_id,
                    actor=user.user_id,
                    payload={"document_id": doc.document_id, "filename": doc.filename, **payload},
                )
            )

    async def get_document(self, user: UserContext, document_id: str) -> DocumentRef:
        doc = await self.documents.get(document_id)
        if doc is None or doc.tenant_id != user.tenant_id:
            raise NotFoundError(f"Document '{document_id}' not found")
        return doc

    async def delete_document(self, user: UserContext, document_id: str) -> None:
        await self.get_document(user, document_id)
        await self.vectors.delete_document(document_id)
        await self.documents.delete(document_id)

    # ---- retrieval -------------------------------------------------------------------------
    async def search(self, tenant_id: str, query: RetrievalQuery) -> list[RetrievedChunk]:
        candidates = await self.vectors.candidates(
            tenant_id, document_ids=query.document_ids, knowledge_base=query.knowledge_base
        )
        if not candidates:
            return []
        emb = await self.llm.embed(EmbeddingRequest(texts=[query.query]), tenant_id=tenant_id)
        qvec = emb.vectors[0]
        lexical = _bm25(tokens(query.query), [tokens(c.text) for c in candidates])
        results: list[RetrievedChunk] = []
        for chunk, lex in zip(candidates, lexical, strict=True):
            dense = max(0.0, _cosine(qvec, chunk.embedding or []))
            score = 0.6 * dense + 0.4 * lex
            if score <= query.min_score:
                continue
            results.append(
                RetrievedChunk(
                    chunk_id=chunk.chunk_id,
                    document_id=chunk.document_id,
                    filename=chunk.metadata.get("filename"),
                    text=chunk.text,
                    page=chunk.page,
                    score=round(score, 6),
                    vector_score=round(dense, 6),
                    keyword_score=round(lex, 6),
                )
            )
        results.sort(key=lambda r: -r.score)
        reranked = self.reranker.rerank(query.query, results[: query.top_k * 4])
        return reranked[: query.top_k]
