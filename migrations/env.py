"""Alembic environment (async). Usage: DATABASE_URL=postgresql+asyncpg://... alembic upgrade head"""

import asyncio
import os

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from ai_storage.tables import Base
import display_registry.tables  # noqa: F401  registry tables share the platform metadata

target_metadata = Base.metadata


def _url() -> str:
    url = os.getenv("DATABASE_URL") or context.config.get_main_option("sqlalchemy.url")
    if not url or url == "memory":
        raise RuntimeError("Set DATABASE_URL to run migrations")
    return url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True,
                      render_as_batch=_url().startswith("sqlite"))
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata,
                      render_as_batch=connection.dialect.name == "sqlite", compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url())
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
