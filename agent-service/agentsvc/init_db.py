"""One-off database setup: creates the LangGraph checkpoint tables and agent_threads in Neon.

    DATABASE_URL=postgresql://...?sslmode=require  python -m agentsvc.init_db

The service also does this on every start (it is idempotent); running it once by hand proves the connection
string works before the first deploy.
"""

from __future__ import annotations

import asyncio
import sys

from .config import get_settings
from .memory import open_persistence


async def main() -> int:
    s = get_settings()
    if not s.database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    persistence = await open_persistence(s)
    try:
        async with persistence.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' "
                "AND (table_name LIKE 'checkpoint%%' OR table_name = 'agent_threads') ORDER BY 1"
            )
            tables = [r["table_name"] for r in await cur.fetchall()]
        print("ready:", ", ".join(tables))
        return 0
    finally:
        await persistence.close()


if __name__ == "__main__":
    if sys.platform == "win32":  # psycopg's async mode needs the selector loop on Windows
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(main()))
