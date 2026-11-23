"""Persistent LangGraph checkpoints (Neon PostgreSQL) and thread ownership.

* ``AsyncPostgresSaver`` stores every graph step, so a thread (and a pending human approval) survives the
  container scaling to zero. ``setup()`` creates its tables once; it is idempotent.
* Neon's pooled endpoint runs PgBouncer in transaction mode, which does not support prepared statements:
  ``prepare_threshold=None`` turns them off, so either the pooled or the direct connection string works.
* ``agent_threads`` records which user owns each thread. The service checks it before streaming, resuming or
  reading a thread.
* No ``DATABASE_URL`` (development and tests only) = in-memory saver and an in-memory owner map.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

from .config import Settings

logger = logging.getLogger("agentsvc.memory")

THREADS_DDL = """
CREATE TABLE IF NOT EXISTS agent_threads (
    thread_id  TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_threads_user ON agent_threads (user_id, updated_at DESC);
"""


class ThreadStore(Protocol):
    async def owner(self, thread_id: str) -> str | None: ...
    async def claim(self, thread_id: str, user_id: str, title: str) -> None: ...
    async def touch(self, thread_id: str) -> None: ...
    async def list(self, user_id: str, limit: int) -> list[dict[str, Any]]: ...
    async def ping(self) -> bool: ...


class MemoryThreadStore:
    def __init__(self) -> None:
        self._rows: dict[str, dict[str, Any]] = {}

    async def owner(self, thread_id: str) -> str | None:
        row = self._rows.get(thread_id)
        return row["user_id"] if row else None

    async def claim(self, thread_id: str, user_id: str, title: str) -> None:
        self._rows.setdefault(thread_id, {"thread_id": thread_id, "user_id": user_id, "title": title[:120]})

    async def touch(self, thread_id: str) -> None:
        return None

    async def list(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        rows = [r for r in self._rows.values() if r["user_id"] == user_id]
        return [{"thread_id": r["thread_id"], "title": r["title"]} for r in rows[-limit:]][::-1]

    async def ping(self) -> bool:
        return True


class PostgresThreadStore:
    def __init__(self, pool: Any) -> None:
        self.pool = pool

    async def owner(self, thread_id: str) -> str | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT user_id FROM agent_threads WHERE thread_id = %s", (thread_id,))
            row = await cur.fetchone()
        return row["user_id"] if row else None

    async def claim(self, thread_id: str, user_id: str, title: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO agent_threads (thread_id, user_id, title) VALUES (%s, %s, %s) "
                "ON CONFLICT (thread_id) DO NOTHING",
                (thread_id, user_id, title[:120]),
            )

    async def touch(self, thread_id: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE agent_threads SET updated_at = now() WHERE thread_id = %s", (thread_id,))

    async def list(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT thread_id, title, updated_at FROM agent_threads WHERE user_id = %s "
                "ORDER BY updated_at DESC LIMIT %s",
                (user_id, limit),
            )
            rows = await cur.fetchall()
        return [{"thread_id": r["thread_id"], "title": r["title"], "updated_at": r["updated_at"].isoformat()}
                for r in rows]

    async def ping(self) -> bool:
        async with self.pool.connection() as conn:
            await conn.execute("SELECT 1")
        return True


@dataclass
class Persistence:
    checkpointer: BaseCheckpointSaver
    threads: ThreadStore
    pool: Any = None
    kind: str = "memory"

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()


async def open_persistence(s: Settings) -> Persistence:
    if not s.database_url:
        if s.is_production:
            raise RuntimeError("DATABASE_URL is required in production")
        logger.warning("DATABASE_URL not set: checkpoints are in memory and are lost on restart")
        return Persistence(checkpointer=InMemorySaver(), threads=MemoryThreadStore())

    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    pool = AsyncConnectionPool(
        conninfo=s.database_url,
        min_size=0,  # nothing held open while idle: Neon can suspend, the container can scale to zero
        max_size=s.db_pool_max_size,
        max_idle=120,
        open=False,
        check=AsyncConnectionPool.check_connection,  # a Neon compute that suspended drops idle sockets
        kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row},
    )
    await pool.open(wait=True, timeout=30)
    saver = AsyncPostgresSaver(pool)  # type: ignore[arg-type]
    await saver.setup()
    async with pool.connection() as conn:
        await conn.execute(THREADS_DDL)
    logger.info("checkpoints: PostgreSQL")
    return Persistence(checkpointer=saver, threads=PostgresThreadStore(pool), pool=pool, kind="postgres")
