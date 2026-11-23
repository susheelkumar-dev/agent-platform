"""SQLAlchemy (async) implementations of the storage ports."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from ai_core.errors import ErrorInfo
from ai_core.models import (
    AgentManifest,
    AgentRecord,
    DocumentChunk,
    DocumentRef,
    ExecutionPlan,
    ExecutionRecord,
    Message,
    PolicyDecision,
    StepRecord,
)
from ai_core.models.ops import AuditEvent, Conversation, UsageRecord
from ai_storage.tables import (
    AgentCapabilityRow,
    AgentRow,
    AuditRow,
    Base,
    ConversationRow,
    DocumentChunkRow,
    DocumentRow,
    ExecutionRow,
    ExecutionStepRow,
    MessageRow,
    UsageRow,
)

logger = logging.getLogger("ai_storage")


def _tz(value: datetime | None) -> datetime | None:
    """SQLite drops tzinfo; normalize everything to aware UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class Database:
    def __init__(self, url: str, *, pool_size: int = 10, echo: bool = False) -> None:
        self.url = url
        kwargs: dict = {"echo": echo, "pool_pre_ping": True}
        if url.startswith("sqlite"):
            path = url.split("///", 1)[-1]
            if path and path != ":memory:":
                Path(path).parent.mkdir(parents=True, exist_ok=True)
        else:
            kwargs["pool_size"] = pool_size
            kwargs["max_overflow"] = pool_size
        self.engine: AsyncEngine = create_async_engine(url, **kwargs)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, class_=AsyncSession)

    async def create_schema(self) -> None:
        async with self.engine.begin() as conn:
            if self.url.startswith("sqlite"):
                await conn.execute(text("PRAGMA journal_mode=WAL"))
            await conn.run_sync(Base.metadata.create_all)

    async def ping(self) -> bool:
        try:
            async with self.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:  # pragma: no cover - depends on infra
            logger.exception("database ping failed")
            return False

    async def dispose(self) -> None:
        await self.engine.dispose()


# --------------------------------------------------------------------------- agents
class SqlAgentRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    @staticmethod
    def _to_record(row: AgentRow) -> AgentRecord:
        return AgentRecord(
            manifest=AgentManifest.model_validate(row.manifest),
            runtime_type=row.runtime_type,
            service_url=row.service_url,
            status=row.status,
            health=row.health,
            health_detail=row.health_detail,
            consecutive_failures=row.consecutive_failures,
            registered_at=_tz(row.registered_at),
            updated_at=_tz(row.updated_at),
            last_seen_at=_tz(row.last_seen_at),
            last_health_check_at=_tz(row.last_health_check_at),
        )

    async def save(self, record: AgentRecord) -> None:
        m = record.manifest
        async with self.db.sessions.begin() as session:
            row = await session.get(AgentRow, (m.agent_id, m.version))
            values = dict(
                name=m.name,
                description=m.description,
                runtime_type=str(record.runtime_type),
                service_url=record.service_url,
                status=str(record.status),
                health=str(record.health),
                health_detail=record.health_detail,
                consecutive_failures=record.consecutive_failures,
                priority=m.priority,
                manifest=m.model_dump(mode="json"),
                registered_at=record.registered_at,
                updated_at=record.updated_at,
                last_seen_at=record.last_seen_at,
                last_health_check_at=record.last_health_check_at,
            )
            if row is None:
                session.add(AgentRow(agent_id=m.agent_id, version=m.version, **values))
            else:
                for key, value in values.items():
                    setattr(row, key, value)
            await session.execute(
                delete(AgentCapabilityRow).where(
                    AgentCapabilityRow.agent_id == m.agent_id, AgentCapabilityRow.version == m.version
                )
            )
            for cap in m.capability_names:
                session.add(AgentCapabilityRow(agent_id=m.agent_id, version=m.version, capability=cap))

    async def get(self, agent_id: str, version: str) -> AgentRecord | None:
        async with self.db.sessions() as session:
            row = await session.get(AgentRow, (agent_id, version))
            return self._to_record(row) if row else None

    async def list_versions(self, agent_id: str) -> list[AgentRecord]:
        async with self.db.sessions() as session:
            rows = (await session.scalars(select(AgentRow).where(AgentRow.agent_id == agent_id))).all()
            return [self._to_record(r) for r in rows]

    async def list_all(self) -> list[AgentRecord]:
        async with self.db.sessions() as session:
            rows = (await session.scalars(select(AgentRow).order_by(AgentRow.agent_id))).all()
            return [self._to_record(r) for r in rows]

    async def find_by_capability(self, capability: str) -> list[AgentRecord]:
        async with self.db.sessions() as session:
            stmt = (
                select(AgentRow)
                .join(
                    AgentCapabilityRow,
                    (AgentCapabilityRow.agent_id == AgentRow.agent_id)
                    & (AgentCapabilityRow.version == AgentRow.version),
                )
                .where(AgentCapabilityRow.capability == capability)
            )
            rows = (await session.scalars(stmt)).all()
            return [self._to_record(r) for r in rows]

    async def delete(self, agent_id: str, version: str | None = None) -> int:
        async with self.db.sessions.begin() as session:
            cap_stmt = delete(AgentCapabilityRow).where(AgentCapabilityRow.agent_id == agent_id)
            stmt = delete(AgentRow).where(AgentRow.agent_id == agent_id)
            if version is not None:
                cap_stmt = cap_stmt.where(AgentCapabilityRow.version == version)
                stmt = stmt.where(AgentRow.version == version)
            await session.execute(cap_stmt)
            result = await session.execute(stmt)
            return result.rowcount or 0


# --------------------------------------------------------------------------- executions
class SqlExecutionStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def save(self, record: ExecutionRecord) -> None:
        async with self.db.sessions.begin() as session:
            row = await session.get(ExecutionRow, record.execution_id)
            values = dict(
                request_id=record.request_id,
                tenant_id=record.tenant_id,
                user_id=record.user_id,
                conversation_id=record.conversation_id,
                status=str(record.status),
                message=record.message,
                plan=record.plan.model_dump(mode="json") if record.plan else None,
                policy_decisions=[d.model_dump(mode="json") for d in record.policy_decisions],
                response=record.response,
                ui=record.ui,
                error=record.error.model_dump(mode="json") if record.error else None,
                usage=record.usage,
                extra=record.metadata,
                created_at=record.created_at,
                started_at=record.started_at,
                completed_at=record.completed_at,
            )
            if row is None:
                session.add(ExecutionRow(execution_id=record.execution_id, **values))
            else:
                for key, value in values.items():
                    setattr(row, key, value)
            for step in record.steps.values():
                srow = await session.get(ExecutionStepRow, (record.execution_id, step.step_id))
                svalues = dict(
                    capability=step.capability,
                    agent_id=step.agent_id,
                    agent_version=step.agent_version,
                    status=str(step.status),
                    attempts=step.attempts,
                    started_at=step.started_at,
                    completed_at=step.completed_at,
                    duration_ms=step.duration_ms,
                    result=step.result,
                    error=step.error.model_dump(mode="json") if step.error else None,
                    skip_reason=step.skip_reason,
                )
                if srow is None:
                    session.add(
                        ExecutionStepRow(execution_id=record.execution_id, step_id=step.step_id, **svalues)
                    )
                else:
                    for key, value in svalues.items():
                        setattr(srow, key, value)

    @staticmethod
    def _to_record(row: ExecutionRow, steps: list[ExecutionStepRow]) -> ExecutionRecord:
        return ExecutionRecord(
            execution_id=row.execution_id,
            request_id=row.request_id,
            tenant_id=row.tenant_id,
            user_id=row.user_id,
            conversation_id=row.conversation_id,
            message=row.message,
            status=row.status,
            plan=ExecutionPlan.model_validate(row.plan) if row.plan else None,
            policy_decisions=[PolicyDecision.model_validate(d) for d in (row.policy_decisions or [])],
            steps={
                s.step_id: StepRecord(
                    step_id=s.step_id,
                    capability=s.capability,
                    agent_id=s.agent_id,
                    agent_version=s.agent_version,
                    status=s.status,
                    attempts=s.attempts,
                    started_at=_tz(s.started_at),
                    completed_at=_tz(s.completed_at),
                    duration_ms=s.duration_ms,
                    result=s.result,
                    error=ErrorInfo.model_validate(s.error) if s.error else None,
                    skip_reason=s.skip_reason,
                )
                for s in steps
            },
            response=row.response,
            ui=row.ui or [],
            error=ErrorInfo.model_validate(row.error) if row.error else None,
            usage=row.usage or {},
            metadata=row.extra or {},
            created_at=_tz(row.created_at),
            started_at=_tz(row.started_at),
            completed_at=_tz(row.completed_at),
        )

    async def get(self, execution_id: str) -> ExecutionRecord | None:
        async with self.db.sessions() as session:
            row = await session.get(ExecutionRow, execution_id)
            if row is None:
                return None
            steps = (
                await session.scalars(
                    select(ExecutionStepRow).where(ExecutionStepRow.execution_id == execution_id)
                )
            ).all()
            return self._to_record(row, list(steps))

    async def list(self, tenant_id: str, user_id: str | None = None, limit: int = 50) -> list[ExecutionRecord]:
        async with self.db.sessions() as session:
            stmt = select(ExecutionRow).where(ExecutionRow.tenant_id == tenant_id)
            if user_id is not None:
                stmt = stmt.where(ExecutionRow.user_id == user_id)
            rows = (await session.scalars(stmt.order_by(ExecutionRow.created_at.desc()).limit(limit))).all()
            out = []
            for row in rows:
                steps = (
                    await session.scalars(
                        select(ExecutionStepRow).where(ExecutionStepRow.execution_id == row.execution_id)
                    )
                ).all()
                out.append(self._to_record(row, list(steps)))
            return out


    async def list_unfinished(self, created_before: datetime, limit: int = 500) -> list[ExecutionRecord]:
        terminal = ["COMPLETED", "FAILED", "CANCELLED", "REJECTED"]
        async with self.db.sessions() as session:
            stmt = (
                select(ExecutionRow.execution_id)
                .where(ExecutionRow.status.not_in(terminal), ExecutionRow.created_at < created_before)
                .limit(limit)
            )
            ids = list((await session.scalars(stmt)).all())
        return [r for r in [await self.get(i) for i in ids] if r is not None]


# --------------------------------------------------------------------------- conversations
class SqlConversationStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    @staticmethod
    def _conv(row: ConversationRow) -> Conversation:
        return Conversation(
            conversation_id=row.conversation_id,
            tenant_id=row.tenant_id,
            user_id=row.user_id,
            title=row.title,
            created_at=_tz(row.created_at),
            updated_at=_tz(row.updated_at),
        )

    async def get(self, conversation_id: str) -> Conversation | None:
        async with self.db.sessions() as session:
            row = await session.get(ConversationRow, conversation_id)
            return self._conv(row) if row else None

    async def create(self, conversation: Conversation) -> Conversation:
        async with self.db.sessions.begin() as session:
            row = await session.get(ConversationRow, conversation.conversation_id)
            if row is not None:
                return self._conv(row)
            session.add(ConversationRow(**conversation.model_dump()))
            return conversation

    async def touch(self, conversation_id: str, title: str | None = None) -> None:
        async with self.db.sessions.begin() as session:
            row = await session.get(ConversationRow, conversation_id)
            if row is not None:
                row.updated_at = datetime.now(UTC)
                if title:
                    row.title = title[:300]

    async def append(self, conversation_id: str, message: Message) -> None:
        async with self.db.sessions.begin() as session:
            session.add(
                MessageRow(
                    conversation_id=conversation_id,
                    role=message.role,
                    content=message.content,
                    data=message.data,
                    created_at=message.created_at,
                )
            )

    async def messages(self, conversation_id: str, limit: int | None = None) -> list[Message]:
        async with self.db.sessions() as session:
            stmt = select(MessageRow).where(MessageRow.conversation_id == conversation_id)
            stmt = stmt.order_by(MessageRow.id.desc())
            if limit:
                stmt = stmt.limit(limit)
            rows = list((await session.scalars(stmt)).all())
            rows.reverse()
            return [
                Message(role=r.role, content=r.content, data=r.data or {}, created_at=_tz(r.created_at))
                for r in rows
            ]

    async def list(self, tenant_id: str, user_id: str, limit: int = 50) -> list[Conversation]:
        async with self.db.sessions() as session:
            stmt = (
                select(ConversationRow)
                .where(ConversationRow.tenant_id == tenant_id, ConversationRow.user_id == user_id)
                .order_by(ConversationRow.updated_at.desc())
                .limit(limit)
            )
            return [self._conv(r) for r in (await session.scalars(stmt)).all()]

    async def delete(self, conversation_id: str) -> None:
        async with self.db.sessions.begin() as session:
            await session.execute(delete(MessageRow).where(MessageRow.conversation_id == conversation_id))
            await session.execute(
                delete(ConversationRow).where(ConversationRow.conversation_id == conversation_id)
            )


# --------------------------------------------------------------------------- documents / vectors
class SqlDocumentStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    @staticmethod
    def _doc(row: DocumentRow) -> DocumentRef:
        return DocumentRef(
            document_id=row.document_id,
            tenant_id=row.tenant_id,
            owner_id=row.owner_id,
            filename=row.filename,
            content_type=row.content_type,
            size_bytes=row.size_bytes,
            status=row.status,
            chunk_count=row.chunk_count,
            knowledge_base=row.knowledge_base,
            error=row.error,
            metadata=row.extra or {},
            created_at=_tz(row.created_at),
        )

    async def save(self, document: DocumentRef) -> None:
        async with self.db.sessions.begin() as session:
            row = await session.get(DocumentRow, document.document_id)
            values = document.model_dump(exclude={"document_id", "metadata"})
            values["status"] = str(document.status)
            values["extra"] = document.metadata
            if row is None:
                session.add(DocumentRow(document_id=document.document_id, **values))
            else:
                for key, value in values.items():
                    setattr(row, key, value)

    async def get(self, document_id: str) -> DocumentRef | None:
        async with self.db.sessions() as session:
            row = await session.get(DocumentRow, document_id)
            return self._doc(row) if row else None

    async def list(self, tenant_id: str, knowledge_base: str | None = None) -> list[DocumentRef]:
        async with self.db.sessions() as session:
            stmt = select(DocumentRow).where(DocumentRow.tenant_id == tenant_id)
            if knowledge_base is not None:
                stmt = stmt.where(DocumentRow.knowledge_base == knowledge_base)
            rows = (await session.scalars(stmt.order_by(DocumentRow.created_at.desc()))).all()
            return [self._doc(r) for r in rows]

    async def delete(self, document_id: str) -> None:
        async with self.db.sessions.begin() as session:
            await session.execute(delete(DocumentChunkRow).where(DocumentChunkRow.document_id == document_id))
            await session.execute(delete(DocumentRow).where(DocumentRow.document_id == document_id))


class SqlVectorStore:
    """Portable vector store: embeddings in a JSON column, scoring in Python.

    Good for tens of thousands of chunks per tenant. For larger corpora swap in
    a pgvector / dedicated vector DB adapter implementing the same protocol.
    """

    def __init__(self, db: Database) -> None:
        self.db = db

    async def add(self, chunks: list[DocumentChunk]) -> None:
        async with self.db.sessions.begin() as session:
            for c in chunks:
                session.add(
                    DocumentChunkRow(
                        chunk_id=c.chunk_id,
                        document_id=c.document_id,
                        tenant_id=c.tenant_id,
                        knowledge_base=c.knowledge_base,
                        ordinal=c.ordinal,
                        text=c.text,
                        page=c.page,
                        embedding=c.embedding,
                        extra=c.metadata,
                    )
                )

    async def candidates(
        self,
        tenant_id: str,
        *,
        document_ids: list[str] | None = None,
        knowledge_base: str | None = None,
        limit: int = 5000,
    ) -> list[DocumentChunk]:
        async with self.db.sessions() as session:
            stmt = select(DocumentChunkRow).where(DocumentChunkRow.tenant_id == tenant_id)
            if document_ids is not None:
                stmt = stmt.where(DocumentChunkRow.document_id.in_(document_ids))
            if knowledge_base is not None:
                stmt = stmt.where(DocumentChunkRow.knowledge_base == knowledge_base)
            rows = (await session.scalars(stmt.limit(limit))).all()
            return [
                DocumentChunk(
                    chunk_id=r.chunk_id,
                    document_id=r.document_id,
                    tenant_id=r.tenant_id,
                    knowledge_base=r.knowledge_base,
                    ordinal=r.ordinal,
                    text=r.text,
                    page=r.page,
                    embedding=r.embedding,
                    metadata=r.extra or {},
                )
                for r in rows
            ]

    async def delete_document(self, document_id: str) -> None:
        async with self.db.sessions.begin() as session:
            await session.execute(delete(DocumentChunkRow).where(DocumentChunkRow.document_id == document_id))


# --------------------------------------------------------------------------- audit / usage
class SqlAuditStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def append(self, event: AuditEvent) -> None:
        async with self.db.sessions.begin() as session:
            session.add(AuditRow(**event.model_dump()))

    async def list(self, tenant_id: str | None = None, limit: int = 100) -> list[AuditEvent]:
        async with self.db.sessions() as session:
            stmt = select(AuditRow)
            if tenant_id is not None:  # tenant events + platform-level events (registry, etc.)
                stmt = stmt.where(or_(AuditRow.tenant_id == tenant_id, AuditRow.tenant_id.is_(None)))
            rows = (await session.scalars(stmt.order_by(AuditRow.timestamp.desc()).limit(limit))).all()
            return [
                AuditEvent(
                    audit_id=r.audit_id,
                    timestamp=_tz(r.timestamp),
                    tenant_id=r.tenant_id,
                    actor=r.actor,
                    action=r.action,
                    resource=r.resource,
                    outcome=r.outcome,
                    request_id=r.request_id,
                    execution_id=r.execution_id,
                    details=r.details or {},
                )
                for r in rows
            ]


class SqlUsageStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def record(self, usage: UsageRecord) -> None:
        async with self.db.sessions.begin() as session:
            values = usage.model_dump()
            values["success"] = 1 if usage.success else 0
            session.add(UsageRow(**values))

    async def list(self, tenant_id: str | None = None, limit: int = 500) -> list[UsageRecord]:
        async with self.db.sessions() as session:
            stmt = select(UsageRow)
            if tenant_id is not None:
                stmt = stmt.where(UsageRow.tenant_id == tenant_id)
            rows = (await session.scalars(stmt.order_by(UsageRow.timestamp.desc()).limit(limit))).all()
            return [
                UsageRecord(
                    usage_id=r.usage_id,
                    timestamp=_tz(r.timestamp),
                    tenant_id=r.tenant_id,
                    user_id=r.user_id,
                    agent_id=r.agent_id,
                    request_id=r.request_id,
                    execution_id=r.execution_id,
                    provider=r.provider,
                    model=r.model,
                    purpose=r.purpose,
                    prompt_tokens=r.prompt_tokens,
                    completion_tokens=r.completion_tokens,
                    cost_usd=r.cost_usd,
                    latency_ms=r.latency_ms,
                    success=bool(r.success),
                )
                for r in rows
            ]
