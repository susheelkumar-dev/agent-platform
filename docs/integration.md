# Integrating the platform into an existing application

## Option A — platform as a service (any stack)

Run the platform (Docker/Kubernetes) and call it from your app.

```http
POST /api/v1/chat
Authorization: Bearer <user's OIDC access token>
Content-Type: application/json

{"message": "Compare inventory valuation with trading exposure",
 "conversation_id": "optional-stable-id",
 "capabilities": null,
 "variables": {"period": "2026-09"},
 "mode": "sync"}
```

Response (abridged): `status`, `response` (text), `ui` (artifacts), `steps`, `plan`,
`citations`, `execution_id`. Execution-level outcomes (`COMPLETED/FAILED/REJECTED`) come back
as HTTP 200 with a `status`; HTTP errors are reserved for auth (401/403), validation (422),
guardrails (400) and rate limits (429, with `Retry-After`).

* **Streaming:** `POST /api/v1/chat/stream` returns Server-Sent Events: `accepted`,
  `PlanCreated`, `PlanValidated`, `ExecutionStepStarted/Retrying/Completed/Failed/Skipped`,
  and a terminal `ExecutionCompleted|ExecutionFailed|ExecutionCancelled|PlanRejected` whose
  `payload.response` is the full ChatResponse.
* **Background jobs:** `"mode": "async"` → `202` with links; poll `GET /api/v1/executions/{id}`
  or stream `/events`; cancel with `POST /api/v1/executions/{id}/cancel`.
* **Deterministic calls:** pass `capabilities` (skip text routing) and `variables` (structured
  input every step receives) — useful for buttons/workflows in an existing UI.
* **Dry run:** `POST /api/v1/plans/preview` shows resolution, plan, execution order and
  policy decisions without executing.

### Clients

* Python: `from ai_platform_client import PlatformClient, AsyncPlatformClient`
* TypeScript (Angular/React/Node): `sdk/typescript` (`AgentPlatformClient`, `chatStream()`)
* .NET / Java / others: generate from `docs/api/openapi.json` (NSwag, Kiota, openapi-generator)

### Identity

Point the platform at your IdP (`AUTH_MODES=["jwt"]`, `JWT_JWKS_URL`, `JWT_ISSUER`,
`JWT_AUDIENCE`). Map claims with `JWT_TENANT_CLAIM`, `JWT_ROLES_CLAIM`,
`JWT_PERMISSIONS_CLAIM` (OAuth `scp` is also read), and roles to permissions with
`ROLE_PERMISSIONS`. Your front end forwards the user's access token; the platform derives the
tenant from it. Server-to-server callers can use `STATIC_TOKENS` entries (API keys bound to a
tenant and permission set).

### Rendering results

Render `ui` artifacts by `type` (`metric`, `table`, `chart`, `citations`, `text`); ignore
unknown types. (`approval` is defined in the contract; the pause/resume flow behind it is on the roadmap.) The bundled UI (`/`) is a reference renderer in plain JS.

## Option B — embed in an existing FastAPI application

```python
from contextlib import asynccontextmanager
from platform_api import create_app

ai = create_app(settings, local_agents=[OrdersAgent()])

@asynccontextmanager
async def lifespan(app):
    async with ai.router.lifespan_context(ai):   # mounted apps don't get lifespan events by themselves
        yield

app = FastAPI(lifespan=lifespan)
app.mount("/ai", ai)                             # UI at /ai/, API at /ai/api/v1/...
```

See `examples/embedded_app/app.py` (tested in `tests/integration/test_embedded.py`).

## Option C — in-process agents

`local_agents=[...]` registers `BaseAgent` instances that run inside the platform process
(`runtime_type=local`). Use for thin adapters over code the host app already has; use remote
agents for anything owned by another team or needing independent scaling.

## Customization points

| Extend | How |
|---|---|
| Policy | `create_app(policy_engine=PolicyEngine(settings, rules=[..., MyRule()]))` |
| Storage | implement a protocol in `ai_core/interfaces.py` (e.g. pgvector `VectorStore`) |
| LLM provider | implement `LLMProvider` (`generate`, `embed`) and pass via `LLMGateway(providers=...)` |
| Guardrails | implement `Guardrail.check(text)` and add to `GuardrailService` |
| Reranker | implement `Reranker.rerank(query, items)` (e.g. a cross-encoder) |
| Document parsers | add to `ai_rag.parsing.PARSERS` (e.g. OCR for scanned PDFs) |
