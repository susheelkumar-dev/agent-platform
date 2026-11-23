# Building agents

## 1. Scaffold

```bash
agentctl create credit-risk --capability credit.exposure.read --capability credit.limit.read \
  --keyword credit --keyword "credit limit" --example "What is ACME's credit exposure?" \
  --permission credit.read --template llm --port 8110
```

Templates: `basic` (tool + table), `llm` (adds a platform LLM call), `rag` (adds document retrieval).

## 2. Declare what the agent can do

```python
capabilities = [
    capability(
        "credit.exposure.read",                    # stable contract name: <domain>.<entity>.<verb>
        "Counterparty credit exposure",            # shown in the catalog and to the LLM resolver
        keywords=["credit", "counterparty", "credit exposure"],   # phrases allowed
        examples=["What is ACME's credit exposure?"],
        permissions=["credit.read"],               # in addition to agent-level permissions
        input_model=CreditQuery,                   # Pydantic → JSON Schema, validated by platform + SDK
    ),
]
```

Routing is deterministic first: the resolver scores the user's words against **your**
keywords (phrases weigh more), capability name segments and example similarity. Several
capabilities can match one request (they run in parallel and are aggregated). Use the
`/api/v1/plans/preview` endpoint or `agentctl preview "…"` to check how a sentence routes.

Naming: keep capability names stable; bump the agent `version` when behaviour changes. Two
agents may implement the same capability (e.g. v1 and v2, or a regional variant) — the
platform picks the healthiest, highest-priority, newest version and fails over between them.

## 3. Implement `execute`

```python
async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
    q = request.input                       # validated dict (message + mapped/structured fields)
    rows = await self.tools.call("credit-db", q, context)          # permission-checked, timed
    return AgentResult.success(
        {"rows": rows, "total_exposure": sum(r["exposure"] for r in rows), "currency": "USD"},
        summary=f"Exposure across {len(rows)} counterparties.",
        artifacts=[Artifact.metric(...), Artifact.table(...)],
    )
```

* `context.user` is the authenticated user (tenant, roles, permissions) — enforce row-level
  rules in your tools with it.
* Raise `RetryableAgentError` for transient failures; return `AgentResult.failure(...)` for
  business errors.
* Set `idempotent = False` if `execute` has side effects that must never run twice. Otherwise
  the `Idempotency-Key` header + the SDK's replay cache make retries safe.
* Long-running dependencies: set `timeout_seconds`; the platform enforces it too.

### Tools

Expose systems as **semantic operations**, never raw SQL or open network access:

```python
class CreditDbTool(BaseTool):
    name = "credit-db"
    permissions = ["credit.read"]          # the calling user must hold these
    async def execute(self, input, context=None):
        async with engine.connect() as c:  # credentials from env/secret store, not prompts
            ...
```

### Platform services (no API keys in agents)

```python
llm = await self.platform.generate(context, "Explain the drivers", system="Be concise", response_format="json")
hits = await self.platform.search(context, "credit policy limits", top_k=5)
```

Usage is metered per tenant and agent (`GET /api/v1/admin/usage`).

## 4. Test

```python
result = await run_agent_locally(MyAgent(), {"message": "test"})          # no HTTP
agent.platform = FakePlatformServices(llm_reply="canned")                  # stub LLM/RAG
report = await check_agent_service(client, url, service_token=..., signing_secret=...)  # contract
```

`agentctl test --url http://127.0.0.1:8110` runs the contract check against a running service.

## 5. Run and deploy

```bash
python main.py                                    # dev; registers with AGENT_PLATFORM_URL
uvicorn main:app --host 0.0.0.0 --port 8080      # prod (set AGENT_SERVICE_URL to the reachable URL)
docker build -t registry/credit-risk-agent:1.0.0 . && kubectl apply -f k8s.yaml
```

| Env var | Purpose |
|---|---|
| `AGENT_PLATFORM_URL` | platform base URL |
| `AGENT_SERVICE_URL` | how the platform reaches this service |
| `AGENT_REGISTRATION_TOKEN` | must match platform `REGISTRATION_TOKEN` (or per-agent token) |
| `AGENT_SERVICE_TOKEN` / `AGENT_SIGNING_SECRET` | verify platform calls |
| `AGENT_MAX_CONCURRENCY` | overrides manifest; returns 429 above it |
| `AGENT_HEARTBEAT_INTERVAL_SECONDS` | default 20 (platform may ask for less) |

## 6. Operate

* Roll out v2 next to v1 → both healthy → platform prefers v2; `agentctl agents deprecate my-agent --version 1.0.0`.
* Emergency stop: `agentctl agents disable my-agent` (sticky; heartbeats don't re-enable it).
* Health: `/ready` returning 503 removes the agent from routing within one probe interval.
