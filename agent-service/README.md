# agent-service

Multi-agent service behind the portfolio's AI lab: FastAPI + LangGraph, Server-Sent Events, PostgreSQL (Neon)
checkpoints, human approval before any data change, and a zero-cost model chain (Groq → Gemini → OpenRouter `:free`).
Only the portfolio's ASP.NET Core BFF calls it (`X-Internal-Api-Key`).

```
START → router ─┬─ gridtrade_agent ⇄ gridtrade_tools   GridTrade demo API; confirm_trade pauses for approval
                ├─ migration_agent ⇄ migration_tools   the Ext JS → React migration report (data/)
                └─ general_agent                       the lab itself
```

| File | Purpose |
|---|---|
| `main.py` | HTTP API and SSE endpoints |
| `agentsvc/graph/builder.py` | the LangGraph graph (router, agents, tool loops) |
| `agentsvc/tools/` | GridTrade tools (writes call `interrupt()`), migration-report tools |
| `agentsvc/llm_factory.py` | provider chain with `.with_fallbacks()`, tools bound on every provider |
| `agentsvc/memory.py` | `AsyncPostgresSaver` + thread ownership table; in-memory without `DATABASE_URL` (dev only) |
| `agentsvc/streaming.py` | `astream_events(version="v2")` → a small stable event envelope, keep-alives |

## API

All `/api` routes need `X-Internal-Api-Key` and `X-User-Id` (the BFF's visitor id; threads belong to it).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | liveness, no database call |
| GET | `/ready` | | `{"status","db","providers"}` |
| POST | `/api/v1/agent/stream` | `{"thread_id"?: str, "message": str}` | `text/event-stream` |
| POST | `/api/v1/agent/resume` | `{"thread_id","interrupt_id","decision":"approve"\|"reject","comment"?}` | `text/event-stream` |
| GET | `/api/v1/agent/threads` | | the caller's threads |
| GET | `/api/v1/agent/threads/{id}` | | `{"status","pending_interrupt","messages"}` |

SSE events: `metadata {thread_id, run_id}`, `step {node, status, tool?, input?, output?}`, `token {node, text}`,
`interrupt {thread_id, interrupt_id, kind, title, action, preview, options}`, `error {code, message, retryable}`,
`done {thread_id, status: completed|interrupted|failed}`, and a `: keep-alive` comment every 15 s.

## Run

```bash
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt pytest
cp .env.example .env                               # INTERNAL_API_KEY + at least one LLM key
uvicorn main:app --port 8000
python -m pytest -q                                # scripted model: no keys, no network
TEST_DATABASE_URL=postgresql://... python -m pytest -q tests/test_postgres.py   # restart survives in PostgreSQL
python tests/fake_server.py 18100                  # the real service on the scripted model, for UI work
```

Container: `docker build -t agent-service .` (python:3.11-slim, non-root, binds `$PORT`). About 136 MB resident with
all providers loaded. Deployment: `../DEPLOYMENT.md`.
