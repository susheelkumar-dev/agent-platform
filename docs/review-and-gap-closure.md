# Review of the design set and the starter, and gap closure

Baseline reviewed (October 2026): *Architecture & Design*, *LLD*, *File-by-File Blueprint*,
*Gap Analysis & Living Checklist*, *Implementation Status*, and the `ai-agent-platform-starter`
code (independent-services variant with G01/G06 applied).

## 1. Verdict on the design documents

The direction is right for the goal — "an operating layer for agents that any organization can
plug in": registry-authoritative, capability-first routing, a bounded LLM, explicit workflow
state, and agents as independently deployed services. Those principles are kept unchanged.

Issues found in the documents, and how they are resolved in the implementation:

| # | Issue in the docs | Resolution |
|---|---|---|
| D1 | The three documents disagree on core contracts: `PlanStep` is `step_id/input_mapping` (LLD) vs `id/output_key` (Blueprint); `input_schema` is a dict (LLD) vs a type name string (Blueprint); registry is `agents` + `agent_versions` (LLD) vs a single `agents` table (Blueprint) | One versioned contract set (`ai_core/models`), LLD naming; registry keyed by `(agent_id, version)` with a normalized capability index |
| D2 | LLD §32 mixes **operational health** (DEGRADED) into the **administrative lifecycle** (DISABLED/DEPRECATED). With self-registering agents this lets an agent's heartbeat undo an admin's decision | Two independent axes: `status` (admin, sticky) and `health` (heartbeats/probes) |
| D3 | Where routing rules live is never specified. The starter put domain words (`inventory`, `exposure`) in `LLMGateway.classify()` — contradicting "platform never knows the domain" | Routing hints (keywords, examples) are part of the **agent manifest**; the platform only scores them |
| D4 | No trust model between platform and agents ("mTLS later") | Registration token (shared or per-agent), bearer + HMAC-signed execute calls with replay window, platform-signed context tokens for agent → platform callbacks |
| D5 | Partial-failure semantics are undefined (what does an aggregator do when one branch fails?) | Trigger rules (`all_success`, `all_done`), `required` steps, partial answers with explicit failure notes |
| D6 | Idempotency is mentioned (LLD §30) but not designed | Idempotency key per step, SDK replay cache, `idempotent: false` disables retries |
| D7 | Seven separately deployed platform services (gateway, runtime, registry, workflow, RAG, ingestion, observability) from day one | **Modular monolith + independent agents.** The platform is one deployable with strict module boundaries (each behind a port), so a module can be extracted later; agents remain fully independent. This removes six network hops and six deployments without losing the extension points |
| D8 | "Redis for state/cache/locks" with no statement of which components actually need shared state | Identified precisely: event bus, rate limiter, in-flight cancellation. Everything else is in PostgreSQL. Multi-replica behaviour is documented and degrades safely |
| D9 | Follow-ups ("now make it a bar chart") are described but have no mechanism | Assistant turns store a compact structured result; planner maps `$conversation.last_result` |
| D10 | LangGraph is assumed in the status doc while the Blueprint describes a custom orchestrator | Both: one step executor, two schedulers (`ENGINE=native|langgraph`) with identical semantics |

## 2. Review of the starter code (before this upgrade)

| Severity | Finding |
|---|---|
| Blocker | Routing hard-coded to the demo domain (`ai_llm/gateway.py`): new organizations' agents could register but never be routed to |
| Blocker | Only one step could ever run: `results["step-1"]` hard-coded in `main.py`; planner/orchestrator single-step |
| High | Registry, conversations and executions in memory; no heartbeat/health — a dead agent stayed `active` forever; heartbeat re-registration every 10 s with no health semantics |
| High | Security demo-only: one static user, shared tokens compared with `!=`, no tenants, no signing, no audit |
| High | Global singletons in `dependencies.py` — not embeddable, not testable in isolation |
| Medium | `src/examples` duplicated `services/*` inside the platform package (platform shipped domain code) |
| Medium | Errors surfaced as HTTP 400 with `str(exc)`; no error taxonomy or retry semantics |
| Medium | Repository interface synchronous (would block the event loop with a real database) |
| Hygiene | Zip contained a Windows `.venv`, `__pycache__`, `egg-info` and a `.env` (its API key was empty) |

All of the above are fixed in this version.

## 3. Gap register (G01–G27)

| ID | Gap | Status | Implementation / evidence |
|---|---|---|---|
| G01 | Independent agent services | ✅ | `ai_agent_sdk.create_agent_app`; examples run as separate processes; `agentctl create` |
| G02 | Automatic discovery/registration | ✅ | register → heartbeat → re-register on 404 → deregister on shutdown (push model) |
| G03 | Operational AgentManifest | ✅ | `AgentManifest` v2, validation, reserved names, v1 compatibility |
| G04 | Health/readiness/lifecycle | ✅ | `/health`, `/ready`, heartbeats, `HealthMonitor`, status × health model |
| G05 | Persistent registry | ✅ | SQL repository (PostgreSQL/SQLite), survives restart (test) |
| G06 | Remote runtime boundary | ✅ | `AgentRuntimeDispatcher` → local/remote, circuit breaker |
| G07 | Multi-step planner | ✅ | `RulePlanner` (parallel+aggregate, chart, follow-up, documents) + `LLMPlanner` |
| G08 | Dependency-aware graph | ✅ | native DAG scheduler + `LangGraphExecutionEngine` |
| G09 | Explicit result passing | ✅ | `input_mapping` refs, data-flow validation |
| G10 | Retry/timeout/cancellation/concurrency | ✅ | per-step + workflow timeouts, backoff+jitter, cancel API, semaphore, failover |
| G11 | Persistent execution state | ✅ | executions + steps tables, `GET/cancel/events`, interrupted-run recovery |
| G12 | Persistent conversation memory | ✅ (Redis ◻) | SQL conversations/messages; Redis not required for correctness |
| G13 | Real LLM gateway | ✅ | OpenAI, Azure OpenAI, Anthropic, OpenAI-compatible/Ollama, fallback, cost |
| G14 | Structured LLM output | ✅ | JSON mode + parsing; outputs filtered to registered capabilities |
| G15 | Policy engine | ✅ | rule-based `PolicyEngine`, decisions recorded per step, pluggable |
| G16 | OIDC/JWT + tenant isolation | ✅ | `JWTAuthenticator` (JWKS/HS), tenant-filtered everything (tests) |
| G17 | Production tool framework | ◐ | `BaseTool`/`ToolBox` with user-permission checks + metrics; no platform-level tool catalog |
| G18 | RAG subsystem | ✅ (pgvector ◻, OCR ◻) | parsing, chunking, embeddings, hybrid retrieval, citations, scoped KBs |
| G19 | Result aggregator / response builder | ✅ | `ResponseBuilder`, built-in aggregator/chart agents |
| G20 | Observability + audit | ✅ | JSON logs with correlation IDs, Prometheus metrics, audit log, OTel hook |
| G21 | Event model / bus | ◐ | versioned events + in-process bus; Kafka/Redis adapter not implemented |
| G22 | SDK + agentctl | ✅ | agent SDK, Python + TypeScript clients, `agentctl` |
| G23 | Agent infrastructure generation | ✅ | Dockerfile, k8s.yaml, tests, .env, README per generated agent |
| G24 | Contract testing | ✅ | `check_agent_service`, `agentctl test`, contract tests |
| G25 | Versioning and rollout | ✅ (weighted canary ◻) | multi-version selection, deprecate/disable/retire, failover |
| G26 | Deployment topology | ✅ | Dockerfiles, compose, k8s (HPA, PDB, NetworkPolicy, migration Job) |
| G27 | Test pyramid | ◐ | 55 unit/contract/integration/e2e + failure-injection tests; load tests not included |

## 4. What was verified, and what was not

Verified here: the full test suite (55 passing; PostgreSQL test gated to CI); a real
multi-process run (platform + two agent services over HTTP) including kill/restart recovery;
the UI in a headless browser (desktop + mobile); SDK-only install without platform
dependencies; Alembic upgrade/downgrade and ORM parity on SQLite plus PostgreSQL DDL
generation; TypeScript client type-check.

**Not** verified in this environment (no network access to those services): execution against a
live PostgreSQL server, Docker image builds, calls to live LLM providers (wire formats are
tested against recorded request/response shapes), OpenTelemetry export. The CI workflow
covers PostgreSQL, image builds and a compose smoke test.

## 5. Known limitations and roadmap

1. **Shared state for multi-replica** — Redis-backed `EventBus` and `RateLimiter`, cross-replica cancel.
2. **Human-in-the-loop** — `WAITING` state + approval artifacts with resume API.
3. **Durable execution** — resume interrupted workflows from persisted step results (today: marked failed).
4. **pgvector `VectorStore`** and an OCR parser for scanned PDFs.
5. **.NET agent SDK (NuGet)** — the wire contract is plain HTTP + HMAC (`docs/agent-contract.md`), so a
   thin ASP.NET Core package would let .NET teams write agents natively; generate the client side from OpenAPI.
6. **Kafka/RabbitMQ event export** for downstream analytics and async agents.
7. **Weighted canary routing** between agent versions and per-tenant model routing.
8. **Load tests** (Locust/k6) and chaos tests in CI.
