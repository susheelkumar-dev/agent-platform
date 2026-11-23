# Architecture

This document maps the design set (Architecture & Design, LLD, File-by-File Blueprint)
onto the code that now implements it.

## 1. Principles, as enforced in code

| Principle (Arch §2) | Where it is enforced |
|---|---|
| Registry is authoritative | `AgentRegistry.select()` is the only way a step gets an agent; the LLM never names agents |
| Capability-first routing | `CapabilityResolver` maps text → capabilities using hints declared **in agent manifests**; `platform_api` has no domain vocabulary |
| LLM is bounded | LLM classifier/planner output is filtered to registered capabilities and always passes `PlanValidator` |
| Workflow is first-class | `ExecutionPlan`/`PlanStep` (deps, `input_mapping`, conditions, trigger rules, retry, timeout) executed by `ExecutionEngine` |
| Interfaces before implementations | `ai_core/interfaces.py` ports; memory + SQL adapters in `ai_storage`; providers in `ai_llm/providers` |
| Security by default | tenant from credential only; policy decision recorded for every step; signed agent calls; production config gate |
| Observable by default | every transition is a `PlatformEvent` → audit, SSE, metrics; logs carry request/execution/tenant IDs |
| Platform never imports app code | agents are remote services (or explicitly injected `local_agents`); `platform-` IDs and `platform.` capabilities are reserved |

## 2. Request lifecycle (Arch §6, LLD §3)

```
POST /api/v1/chat ─► auth (JWT/static) ─► rate limit ─► guardrails ─► conversation (tenant+user owned)
   ─► CapabilityResolver   explicit | attachments | manifest keywords/examples | bounded LLM | fallback
   ─► Planner              rule-v2 (default) or llm-v2 → ExecutionPlan (DAG)
   ─► PlanValidator        DAG, data-flow, limits, registry selection, PolicyEngine decisions
   ─► ExecutionEngine      ready-set scheduling, parallel, retries, failover, timeouts, cancel
         └► AgentRuntimeDispatcher → LocalAgentRuntime | RemoteHttpAgentRuntime (signed HTTP)
   ─► ResponseBuilder      text + UI artifacts + citations + compact result for follow-ups
   ─► memory + execution store + terminal event (SSE subscribers get the full response)
```

Execution states: `CREATED → PLANNING → VALIDATING → READY → RUNNING → COMPLETED | FAILED | CANCELLED`, or `REJECTED` (validation/policy). Step states: `PENDING → RUNNING → SUCCEEDED | FAILED | SKIPPED | CANCELLED`.

## 3. Components → code

| Component | Module | Notes |
|---|---|---|
| Contracts | `ai_core/models/*` | `AgentManifest` v2 (v1 lists accepted), `ExecutionPlan`, `ExecutionRecord`, `AgentResult`, artifacts |
| Errors | `ai_core/errors.py` | categories → HTTP status + retry semantics |
| Events | `ai_core/events.py` | versioned envelope; in-process bus with per-execution replay |
| Registry | `ai_agents/registry.py` | versions, sticky admin status, health transitions, catalog, selection order (health → priority → semver) |
| Health monitor | `ai_agents/health.py` | probes `/ready`; 1 failure → degraded, N → unhealthy (not routable) |
| Resolver | `ai_orchestration/resolver.py` | keyword/phrase/example scoring; unavailable capabilities still matched for a clear "temporarily unavailable" answer |
| Planner | `ai_orchestration/planner.py` | single, parallel+aggregate, data→chart, follow-up chart, document Q&A, fallback |
| Validator | `ai_orchestration/validator.py` | topological levels returned for UI/preview |
| Mapping & conditions | `ai_orchestration/mapping.py` | `$steps/$request/$variables/$context/$conversation` refs; AST-whitelisted conditions |
| Engine | `ai_orchestration/engine.py` | native asyncio scheduler and `LangGraphExecutionEngine` share one step executor |
| Built-in agents | `ai_orchestration/builtin_agents.py` | aggregator (joins on shared dimension), chart, document Q&A, general |
| Runtime | `ai_runtime/runtime.py` | HMAC signing, idempotency key, deadline, circuit breaker, error mapping |
| LLM gateway | `ai_llm/gateway.py` | routing, aliases, fallback chain, retries, JSON parsing, cost, usage store |
| RAG | `ai_rag/*` | parse → chunk → embed → store; hybrid retrieval + reranker hook |
| Security | `ai_security/*` | `AuthService`, `PolicyEngine`, `GuardrailService`, rate limiter, signing |
| Storage | `ai_storage/*` | memory + SQLAlchemy async; schema in `tables.py`, Alembic in `migrations/` |
| API | `platform_api/*` | app factory, container (composition root), routers, `ChatService` |
| SDK | `ai_agent_sdk/*` | `create_agent_app`, `run_agent`, HTTP platform services, testing harness |

## 4. Key decisions

* **Push registration + pull health.** Agents register and heartbeat (works behind NAT, any
  orchestrator); the platform also probes `/ready` so a crashed agent is detected even if it
  can't say goodbye. Graceful shutdown deregisters immediately (`offline`).
* **Admin decisions beat agent self-reports.** Re-registration never re-enables a
  `disabled/deprecated/retired` version.
* **Joins use `all_done`.** The aggregator runs even when a branch fails, so users get partial
  answers with an explicit failure note; the execution is still reported `FAILED`.
* **Failover is capability-level.** A step whose agent is unavailable retries on the next
  healthy implementation of the same capability (e.g. the previous version).
* **Agents never hold platform secrets for LLM/RAG.** They get a short-lived, platform-signed
  context token per request; tenant/user come from that token.
* **Two schedulers, one semantics.** LangGraph is supported (`ENGINE=langgraph`) because the
  design set specifies it; the native scheduler is the default for fewer moving parts.
