# AI Agent Platform

**Drop-in agentic AI infrastructure.** Application teams build agents as small independent
microservices; the platform supplies everything else: discovery, routing, multi-step
planning, policy enforcement, orchestration, LLM access, document Q&A (RAG), memory,
security, observability and a chat UI.

```
  Your apps / UI ──REST·SSE──▶ ┌──────────────────── PLATFORM ─────────────────────┐
  (Python/TS clients,          │ Auth (OIDC/JWT) → Guardrails → Conversation memory  │
   OpenAPI for .NET/Java)      │ Capability resolver (manifest hints ∥ bounded LLM)  │
                               │ Planner → Plan validator + Policy engine            │
                               │ DAG engine: parallel · retries · timeouts · cancel  │
                               │ Registry (versions · health · lifecycle) · Audit    │
                               │ LLM gateway (OpenAI/Azure/Anthropic/Ollama) · RAG   │
                               └───────▲──────────────┬───────────────┬─────────────┘
                     register/heartbeat│   signed HTTP│ execute       │ in-process
                               ┌───────┴──────┐ ┌─────▼────────┐ ┌────▼─────────────┐
                               │ inventory-   │ │ exposure-    │ │ built-ins: compare│
                               │ agent :8101  │ │ agent :8102  │ │ chart · docs Q&A  │
                               └──────────────┘ └──────────────┘ └───────────────────┘
                                 each team deploys, versions and scales its own agent
```

The rule that makes it a framework: **the platform never imports application code.**
Adding the 3rd or the 300th agent means deploying a service that registers itself — no
platform change, no redeploy.

---

## 5-minute quick start

```bash
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cp .env.example .env

make run-platform                                        # terminal 1 → http://127.0.0.1:8000
make run-inventory                                       # terminal 2 (self-registers)
make run-exposure                                        # terminal 3 (self-registers)
```

Open **http://127.0.0.1:8000** and try:

| Ask | What happens |
|---|---|
| *Show inventory valuation for last month* | 1 step → inventory-agent |
| *Compare my inventory valuation with my gas and power trading exposure* | S1 ∥ S2 in parallel → aggregate (joins on the shared `commodity` dimension) → table + chart |
| *Now make it a bar chart* (follow-up) | reuses the previous result via `$conversation.last_result` |
| 📎 attach a policy PDF + *What is the leave approval process?* | ingest → retrieve → grounded answer with citations |
| switch identity to `demo-viewer`, ask for trading exposure | rejected by the policy engine (missing `trading.exposure.read`) |

Or use Docker: `docker compose up --build` (PostgreSQL + migrations + platform + 2 agents).

### Ext JS to React on Windows (GridTrade), in three commands

With `gridtrade-contracts-extjs` next to this folder, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1        # venv, installs, config, tests
powershell -ExecutionPolicy Bypass -File scripts\migrate-gridtrade.ps1  # -> ..\gridtrade-react, build-checked
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -WithPlatform
```

`start-local.ps1` starts the GridTrade API (:5080), the display registry (:8130), registers the menus, runs the React
app (:5173) and, with `-WithPlatform`, the platform (:8000) and the migration agent (:8120). `stop-local.ps1` stops
them. Logs are in `..\.local-run`.

### Design new displays visually: UI Forge

```powershell
scripts\start-local.ps1 -WithBuilder        # ... plus the builder on http://127.0.0.1:8140
```

UI Forge designs Summary, Entry and Master-Slave displays for the migrated React app (drag and drop, live preview
with the app's own framework, permission simulation), keeps the design as versioned JSON in the app, and generates
the frontend, a permission-checked API, registry manifests and tests, without ever overwriting your code. See
[src/ui_forge/README.md](src/ui_forge/README.md).

---

## Build an agent (what your teams actually do)

```bash
agentctl create weather --capability weather.forecast.read \
    --keyword weather --keyword forecast --example "Will it rain tomorrow?" --permission weather.read
cd agents/weather-agent && cp .env.example .env
python main.py                # registers itself; immediately routable
pytest                        # generated unit + contract tests
```

The generated service contains `agent.py`, `main.py`, `Dockerfile`, `k8s.yaml`, tests,
`.env.example` and a README. The only code a team writes:

```python
class WeatherAgent(BaseAgent):
    agent_id = "weather-agent"
    version = "1.0.0"
    capabilities = [capability("weather.forecast.read", "Weather forecasts",
                               keywords=["weather", "forecast"], examples=["Will it rain tomorrow?"])]
    permissions = ["weather.read"]

    async def execute(self, request, context):
        data = await self.tools.call("forecast-api", request.input, context)   # permission-checked tool
        llm = await self.platform.generate(context, f"Summarize: {data}")      # metered via platform
        return AgentResult.success(data, summary=llm.content,
                                   artifacts=[Artifact.table("Forecast", [...], data["rows"])])
```

Agents can be written in **any language**: the contract is plain HTTP + JSON + HMAC
([docs/agent-contract.md](docs/agent-contract.md)).

## Integrate with an existing application

| Mode | Use when | How |
|---|---|---|
| **Service** | Any stack (.NET, Java, Node, Python) | Call `POST /api/v1/chat` or stream `POST /api/v1/chat/stream`; generate a client from `/openapi.json`, or use `sdk/typescript` / `ai_platform_client` |
| **Embedded** | Existing FastAPI app | `app.mount("/ai", create_app(settings, local_agents=[...]))` — see `examples/embedded_app` |
| **In-process agents** | Reuse your own service layer with no network hop | pass `local_agents=[MyAgent()]` to `create_app` |

Existing apps that already know what they need can skip free-text routing:
`{"message": "...", "capabilities": ["inventory.valuation.read"], "variables": {"period": "2026-09"}}`.

---

## What's in the box

| Area | Implementation |
|---|---|
| Registry | Versioned manifests, multi-version per agent, lifecycle (`active/disabled/deprecated/retired`, admin decisions are sticky), health (`healthy/degraded/unhealthy/offline`), heartbeats, active probing, PostgreSQL/SQLite persistence |
| Routing | Capability resolver driven by **agent-declared** keywords/examples (no domain words in platform code); optional LLM classifier that can only choose registered capabilities; explicit capabilities for API callers |
| Planning | Multi-step DAG plans (parallel branches, aggregation joins, follow-ups); optional LLM planner — always validated |
| Validation & policy | Cycle detection, data-flow checks (`$steps.x` must be an ancestor), timeouts, tenant scope, RBAC permissions with wildcards, per-tenant allow/deny lists, step limits, pluggable rules (OPA-style) |
| Execution | Async DAG engine (or LangGraph): bounded parallelism, explicit `input_mapping`, safe conditions, trigger rules, retries with backoff+jitter on retryable categories, per-step & workflow timeouts, cancellation, idempotency keys, **failover to another healthy version**, circuit breaker per endpoint, crash recovery marking |
| Agent runtime | Remote HTTP (bearer + HMAC-signed requests, replay window) and in-process |
| LLM gateway | OpenAI, Azure OpenAI, Anthropic, any OpenAI-compatible server (Ollama, vLLM), offline mock; aliases, ordered fallback, retries, JSON mode, token & cost accounting per tenant/agent |
| RAG | PDF/DOCX/HTML/MD/TXT/CSV/JSON parsing, structure-aware chunking, embeddings via gateway, hybrid dense+BM25 retrieval, reranker hook, citations, tenant & conversation scoping, same-request upload+question |
| Security | OIDC/JWT (JWKS RS256 or HS256, issuer/audience), static API tokens, tenant isolation everywhere, signed context tokens for agent callbacks, guardrails (injection heuristics, size limits), rate limiting, production config gate |
| Observability | JSON logs with request/execution/tenant correlation, Prometheus `/metrics`, optional OpenTelemetry, persistent audit log, LLM usage report |
| Display builder | UI Forge: visual Summary/Entry/Master-Slave designer, versioned display schema, safe plan/apply generation of React code, backend routes with server-side permissions, registry manifests, CLI (`ui-forge`) |
| Developer platform | Agent SDK, `agentctl` (create/validate/test/agents/preview/chat), contract test harness, Python + TypeScript clients, chat UI |
| Delivery | Dockerfiles, docker-compose, Kubernetes (Deployment, HPA, PDB, NetworkPolicy, migration Job), Alembic migrations, GitHub Actions CI |

## Repository layout

```
src/
  ai_core/            contracts (manifest, plan, execution, events, errors), config, storage ports
  ai_agents/          BaseAgent, registry, health monitor
  ai_orchestration/   resolver, planner, validator, engine (+LangGraph), response builder, built-in agents
  ai_runtime/         local + remote runtimes, circuit breaker
  ai_llm/             gateway, providers, versioned prompts
  ai_rag/             parsing, chunking, hybrid retrieval
  ai_memory/          conversation memory
  ai_security/        auth (JWT/static), policy engine, guardrails, rate limit, request signing
  ai_observability/   logging, metrics, tracing, audit
  ai_storage/         in-memory and SQL (SQLAlchemy async) adapters + schema
  platform_api/       FastAPI app factory, routers, chat lifecycle service, UI
  ai_agent_sdk/       what agent teams import (service wrapper, testing utilities)
  ai_platform_client/ what consuming applications import
  agentctl/           developer CLI and service templates
  ui_forge/           UI Forge: display schema, generators, plan/apply, builder service and CLI (`ui-forge`)
ui-forge-web/         the UI Forge builder (React + Vite), built into src/ui_forge/static
agents/
  extjs-migration-agent/  Ext JS -> React + TypeScript migration agent: analyzer, rules, generator,
                          LLM fallback, build check, report; @extreact/runtime (React Ext JS API);
                          CLI `extjs-migrate` and agent service (see its README)
examples/             inventory & exposure agents, embedded-app example
sdk/typescript/       browser/Node client
deploy/               Dockerfiles, Kubernetes manifests
migrations/           Alembic
tests/                unit · contract · integration (55 tests)
docs/                 architecture, agent contract, guides, review & gap register, OpenAPI
```

## Documentation

* [docs/architecture.md](docs/architecture.md) — components, request lifecycle, design decisions
* [docs/agent-contract.md](docs/agent-contract.md) — language-neutral wire contract for agent services
* [docs/building-agents.md](docs/building-agents.md) — SDK guide for agent teams
* [docs/integration.md](docs/integration.md) — plugging the platform into existing applications
* [docs/operations.md](docs/operations.md) — configuration reference, deployment, scaling, runbook
* [docs/security.md](docs/security.md) — threat model and controls
* [src/ui_forge/README.md](src/ui_forge/README.md) — UI Forge, the display builder: workflow, schema, generation, security, CLI
* [docs/review-and-gap-closure.md](docs/review-and-gap-closure.md) — review of the design set, G01–G27 status, known limits, roadmap

## Development

```bash
make test        # 55 tests (unit, contract, integration); PostgreSQL test runs when TEST_DATABASE_URL is set
make lint
make migrate     # alembic upgrade head (DATABASE_URL)
```
