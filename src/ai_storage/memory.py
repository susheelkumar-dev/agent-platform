"""In-memory implementations of every storage port.

Used for unit tests and ``DATABASE_URL=memory`` development. Not durable and
not shared between replicas.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict

from ai_core.models import AgentRecord, DocumentChunk, DocumentRef, ExecutionRecord, Message
from ai_core.models.ops import AuditEvent, Conversation, UsageRecord


class InMemoryAgentRepository:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], AgentRecord] = {}
        self._lock = asyncio.Lock()

    async def save(self, record: AgentRecord) -> None:
        async with self._lock:
            self._items[record.key] = record.model_copy(deep=True)

    async def get(self, agent_id: str, version: str) -> AgentRecord | None:
        item = self._items.get((agent_id, version))
        return item.model_copy(deep=True) if item else None

    async def list_versions(self, agent_id: str) -> list[AgentRecord]:
        return [r.model_copy(deep=True) for (aid, _), r in self._items.items() if aid == agent_id]

    async def list_all(self) -> list[AgentRecord]:
        return [r.model_copy(deep=True) for r in self._items.values()]

    async def find_by_capability(self, capability: str) -> list[AgentRecord]:
        return [
            r.model_copy(deep=True)
            for r in self._items.values()
            if capability in r.manifest.capability_names
        ]

    async def delete(self, agent_id: str, version: str | None = None) -> int:
        async with self._lock:
            keys = [k for k in self._items if k[0] == agent_id and (version is None or k[1] == version)]
            for k in keys:
                del self._items[k]
            return len(keys)


class InMemoryExecutionStore:
    def __init__(self, max_items: int = 5000) -> None:
        self._items: dict[str, ExecutionRecord] = {}
        self._max = max_items

    async def save(self, record: ExecutionRecord) -> None:
        self._items[record.execution_id] = record.model_copy(deep=True)
        if len(self._items) > self._max:
            oldest = next(iter(self._items))
            del self._items[oldest]

    async def get(self, execution_id: str) -> ExecutionRecord | None:
        item = self._items.get(execution_id)
        return item.model_copy(deep=True) if item else None

    async def list(self, tenant_id: str, user_id: str | None = None, limit: int = 50) -> list[ExecutionRecord]:
        items = [
            r
            for r in self._items.values()
            if r.tenant_id == tenant_id and (user_id is None or r.user_id == user_id)
        ]
        items.sort(key=lambda r: r.created_at, reverse=True)
        return [r.model_copy(deep=True) for r in items[:limit]]

    async def list_unfinished(self, created_before, limit: int = 500) -> list[ExecutionRecord]:
        items = [r for r in self._items.values() if not r.status.terminal and r.created_at < created_before]
        return [r.model_copy(deep=True) for r in items[:limit]]


class InMemoryConversationStore:
    def __init__(self) -> None:
        self._conversations: dict[str, Conversation] = {}
        self._messages: dict[str, list[Message]] = defaultdict(list)

    async def get(self, conversation_id: str) -> Conversation | None:
        return self._conversations.get(conversation_id)

    async def create(self, conversation: Conversation) -> Conversation:
        self._conversations.setdefault(conversation.conversation_id, conversation)
        return self._conversations[conversation.conversation_id]

    async def touch(self, conversation_id: str, title: str | None = None) -> None:
        from ai_core.models import utcnow

        conv = self._conversations.get(conversation_id)
        if conv:
            conv.updated_at = utcnow()
            if title:
                conv.title = title

    async def append(self, conversation_id: str, message: Message) -> None:
        self._messages[conversation_id].append(message)

    async def messages(self, conversation_id: str, limit: int | None = None) -> list[Message]:
        items = list(self._messages.get(conversation_id, []))
        return items[-limit:] if limit else items

    async def list(self, tenant_id: str, user_id: str, limit: int = 50) -> list[Conversation]:
        items = [c for c in self._conversations.values() if c.tenant_id == tenant_id and c.user_id == user_id]
        items.sort(key=lambda c: c.updated_at, reverse=True)
        return items[:limit]

    async def delete(self, conversation_id: str) -> None:
        self._conversations.pop(conversation_id, None)
        self._messages.pop(conversation_id, None)


class InMemoryDocumentStore:
    def __init__(self) -> None:
        self._items: dict[str, DocumentRef] = {}

    async def save(self, document: DocumentRef) -> None:
        self._items[document.document_id] = document.model_copy(deep=True)

    async def get(self, document_id: str) -> DocumentRef | None:
        item = self._items.get(document_id)
        return item.model_copy(deep=True) if item else None

    async def list(self, tenant_id: str, knowledge_base: str | None = None) -> list[DocumentRef]:
        return [
            d.model_copy(deep=True)
            for d in self._items.values()
            if d.tenant_id == tenant_id and (knowledge_base is None or d.knowledge_base == knowledge_base)
        ]

    async def delete(self, document_id: str) -> None:
        self._items.pop(document_id, None)


class InMemoryVectorStore:
    def __init__(self) -> None:
        self._chunks: dict[str, DocumentChunk] = {}

    async def add(self, chunks: list[DocumentChunk]) -> None:
        for chunk in chunks:
            self._chunks[chunk.chunk_id] = chunk

    async def candidates(
        self,
        tenant_id: str,
        *,
        document_ids: list[str] | None = None,
        knowledge_base: str | None = None,
        limit: int = 5000,
    ) -> list[DocumentChunk]:
        out = []
        for c in self._chunks.values():
            if c.tenant_id != tenant_id:
                continue
            if document_ids is not None and c.document_id not in document_ids:
                continue
            if knowledge_base is not None and c.knowledge_base != knowledge_base:
                continue
            out.append(c)
            if len(out) >= limit:
                break
        return out

    async def delete_document(self, document_id: str) -> None:
        for key in [k for k, c in self._chunks.items() if c.document_id == document_id]:
            del self._chunks[key]


class InMemoryAuditStore:
    def __init__(self, max_items: int = 10_000) -> None:
        self._items: list[AuditEvent] = []
        self._max = max_items

    async def append(self, event: AuditEvent) -> None:
        self._items.append(event)
        if len(self._items) > self._max:
            del self._items[: len(self._items) - self._max]

    async def list(self, tenant_id: str | None = None, limit: int = 100) -> list[AuditEvent]:
        items = [e for e in self._items if tenant_id is None or e.tenant_id in (tenant_id, None)]
        return list(reversed(items))[:limit]


class InMemoryUsageStore:
    def __init__(self, max_items: int = 50_000) -> None:
        self._items: list[UsageRecord] = []
        self._max = max_items

    async def record(self, usage: UsageRecord) -> None:
        self._items.append(usage)
        if len(self._items) > self._max:
            del self._items[: len(self._items) - self._max]

    async def list(self, tenant_id: str | None = None, limit: int = 500) -> list[UsageRecord]:
        items = [u for u in self._items if tenant_id is None or u.tenant_id == tenant_id]
        return list(reversed(items))[:limit]
