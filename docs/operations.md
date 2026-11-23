# Operations

## Deployment

* **Local:** `make run-platform` + `make run-inventory` + `make run-exposure` (or `scripts/dev.sh` / `scripts/dev.ps1`).
* **Docker Compose:** `docker compose up --build` → PostgreSQL, one-shot migrations, platform, two agents.
* **Kubernetes:** `deploy/k8s` (kustomize): migration Job, platform Deployment (2+ replicas, HPA, PDB,
  read-only root FS, non-root), Service, example agent, NetworkPolicy so agents accept traffic only from
  the platform. Provide `agent-platform-secrets` from your secret manager (`secrets.example.yaml` shows keys).
* **Schema:** `alembic upgrade head` as a release step; set `AUTO_CREATE_SCHEMA=false` in production.

Production start-up refuses to run (`ENVIRONMENT=production`) with default secrets, demo tokens,
SQLite/memory storage, unrestricted `ALLOWED_AGENT_HOSTS`, or JWT mode without keys.

## Configuration reference (main settings)

| Setting | Default | Notes |
|---|---|---|
| `ENVIRONMENT` | development | `production` enables the safety gate |
| `DATABASE_URL` | sqlite (./data) | `postgresql+asyncpg://…` in production; `memory` for throwaway dev |
| `AUTH_MODES` | `["static"]` | `["jwt"]`, or both (JWT tried first) |
| `JWT_JWKS_URL` / `JWT_SECRET` / `JWT_ISSUER` / `JWT_AUDIENCE` | – | OIDC validation |
| `JWT_TENANT_CLAIM` / `JWT_ROLES_CLAIM` / `JWT_PERMISSIONS_CLAIM` | tid / roles / permissions | dotted paths allowed |
| `ROLE_PERMISSIONS` | see config | role → permission list (`*` = admin) |
| `STATIC_TOKENS` | demo tokens | `{"token": {"user_id","tenant_id","roles","permissions"}}` |
| `REGISTRATION_TOKEN` / `AGENT_REGISTRATION_TOKENS` | dev | shared or per-agent registration secrets |
| `AGENT_SERVICE_TOKEN` / `SIGNING_SECRET` | dev | platform → agent auth + HMAC |
| `ALLOWED_AGENT_HOSTS` | `["*"]` | host globs agents may register with (SSRF guard) |
| `TENANT_POLICIES` | `{}` | `{"acme": {"deny_capabilities": ["trading.*"], "allow_capabilities": [...], "max_steps": 6}}` |
| `ENGINE` | native | `langgraph` to schedule with LangGraph |
| `RESOLVER_MODE` / `PLANNER_MODE` | hybrid / rule | `llm` modes need a real provider |
| `MAX_PLAN_STEPS` / `MAX_PARALLEL_STEPS` | 12 / 8 | per execution / per replica |
| `DEFAULT_STEP_TIMEOUT_SECONDS` / `MAX_STEP_TIMEOUT_SECONDS` / `WORKFLOW_TIMEOUT_SECONDS` | 30 / 600 / 180 | |
| `DEFAULT_RETRY_ATTEMPTS` / `RETRY_BACKOFF_SECONDS` | 3 / 0.5 | only for idempotent agents |
| `HEALTH_CHECK_INTERVAL_SECONDS` / `UNHEALTHY_AFTER_FAILURES` | 15 / 3 | |
| `CIRCUIT_BREAKER_FAILURES` / `CIRCUIT_BREAKER_RESET_SECONDS` | 5 / 30 | per agent endpoint |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_API_VERSION` | mock | `openai`, `azure_openai`, `anthropic`, `openai_compatible`, `ollama` |
| `LLM_FALLBACKS` / `LLM_PROVIDERS` / `LLM_MODEL_ALIASES` / `LLM_PRICING` | – | ordered fallback, extra provider keys, aliases, USD per 1k tokens |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` | = LLM | Anthropic has no embeddings → set another provider |
| `COMPOSE_WITH_LLM` | false | let the LLM write the final answer from agent summaries |
| `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP` / `MAX_UPLOAD_MB` | 900 / 150 / 20 | |
| `GUARDRAIL_MODE` / `MAX_MESSAGE_CHARS` | flag / 8000 | `block` rejects suspected injections |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_BURST` | 120 / 30 | per user, per replica |
| `LOG_FORMAT` / `LOG_LEVEL` | text / INFO | use `json` in production |
| `OTEL_ENABLED` | false | needs `pip install .[otel]` + `OTEL_EXPORTER_OTLP_*` |

## Scaling notes

* Agents scale independently (each is its own Deployment; the platform load-balances via the
  agent's Service URL). Use `max_concurrency` for back-pressure (429 → retried).
* The platform is stateless apart from the database **except** for three per-replica components:
  the event bus, the rate limiter and in-flight execution tasks. Consequences with N replicas:
  * SSE for an execution running on another replica falls back to DB polling (1 s granularity);
  * `cancel` only works on the replica running the execution (use session affinity on
    `/api/v1/executions/*` or add a Redis-backed bus — see roadmap);
  * rate limits are per replica.
* Executions interrupted by a crash are marked `FAILED/INTERRUPTED` on the next start-up
  (after 2× the workflow timeout); they are not resumed.
* Vector search scores candidates in Python — fine to tens of thousands of chunks per tenant.
  Beyond that, implement the `VectorStore` port on pgvector or a vector database.

## Observability

* Logs: JSON with `request_id`, `execution_id`, `tenant_id`, `user_id` on every line.
* Metrics (`GET /metrics`, prefix `aap_`): HTTP requests/latency, executions by status,
  execution latency, steps by capability/agent/status, step latency, retries, agent
  invocations, tool calls, LLM requests/tokens/cost/latency, policy denials, guardrail
  findings, registry agents by status/health.
* Audit (`GET /api/v1/admin/audit`): registrations, health/status changes, rejections,
  policy violations, guardrail hits, document ingestion, execution outcomes.
* Usage (`GET /api/v1/admin/usage`): tokens and cost by model and by agent for the tenant.

## Runbook

| Symptom | Check | Action |
|---|---|---|
| "service temporarily unavailable" | `agentctl agents list` (health) | inspect agent `/ready`; restart; it re-registers |
| Agent never appears | agent logs `platform connection failed` | URL/token mismatch, `ALLOWED_AGENT_HOSTS` |
| 401 from agent in step errors | `AGENT_AUTH_FAILED` | align `AGENT_SERVICE_TOKEN` / `SIGNING_SECRET`; clock skew > 5 min |
| Requests REJECTED `POLICY_DENIED` | `POST /api/v1/plans/preview` | grant permission / role mapping / tenant policy |
| Wrong agent chosen | `agentctl preview "…"` | refine manifest keywords/examples; use explicit `capabilities` |
| Bad version misbehaving | – | `agentctl agents disable <id> --version x.y.z` (sticky) |
