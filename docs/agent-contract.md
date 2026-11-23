# Agent service wire contract (v2)

Any service that implements this contract is a platform agent — Python (use
`ai_agent_sdk`), .NET, Java, Go or Node. Everything is HTTP + JSON.

## Endpoints the agent exposes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness. `200 {"status":"ok"}` |
| GET | `/ready` | Readiness. `200` when able to serve, `503` otherwise. **Probed by the platform.** |
| GET | `/api/v1/manifest` | The `AgentManifest` JSON (below) |
| POST | `/api/v1/execute` | Execute one plan step. Body `AgentRequest`, response `AgentResult` |

### Authenticating platform → agent calls

Every `execute` call carries:

```
Authorization: Bearer <AGENT_SERVICE_TOKEN>
X-Platform-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(SIGNING_SECRET, "<t>." + raw_body)>
Idempotency-Key: <execution_id>:<step_id>
X-Request-ID, X-Execution-ID, X-Agent-Attempt, traceparent (when tracing is on)
```

Reject (HTTP 401) if the token differs (constant-time compare), the signature is missing or
wrong, or `|now - t| > 300s`. Verify the signature over the **raw** request bytes before parsing.

C# sketch:

```csharp
var parts = header.Split(',').Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => p[1]);
var payload = Encoding.UTF8.GetBytes(parts["t"] + ".").Concat(rawBody).ToArray();
var expected = Convert.ToHexString(new HMACSHA256(Encoding.UTF8.GetBytes(secret)).ComputeHash(payload)).ToLowerInvariant();
bool ok = CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(parts["v1"]))
          && Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - long.Parse(parts["t"])) <= 300;
```

## Endpoints the agent calls on the platform

All with `Authorization: Bearer <REGISTRATION_TOKEN>` (or a per-agent token from
`AGENT_REGISTRATION_TOKENS`).

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/v1/agent-services/register` | `{"manifest": {...}, "service_url": "http://my-agent:8080"}` | On startup. Response includes `heartbeat_interval_seconds`. Idempotent. |
| POST | `/api/v1/agent-services/heartbeat` | `{"agent_id", "version", "health": "healthy"\|"degraded"}` | Every interval. **404 ⇒ register again.** |
| POST | `/api/v1/agent-services/deregister` | `{"agent_id", "version"}` | On graceful shutdown → `offline`, traffic stops at once |
| POST | `/api/v1/agent-services/llm/generate` | `LLMRequest` | Requires header `X-Platform-Context: <AgentRequest.context_token>` |
| POST | `/api/v1/agent-services/llm/embed` | `{"texts": [...]}` | same |
| POST | `/api/v1/agent-services/rag/search` | `{"query", "top_k", "document_ids"?, "knowledge_base"?}` | same; user must hold `documents.read` |

## AgentManifest

```json
{
  "schema_version": "2",
  "agent_id": "inventory-agent",            // ^[a-z][a-z0-9-]{1,62}$ ; "platform-*" reserved
  "name": "Inventory Agent",
  "version": "1.1.0",                       // semver; one registry entry per version
  "description": "Inventory valuation for power and gas contracts.",
  "capabilities": [{
    "name": "inventory.valuation.read",     // dotted lower-case; "platform.*" reserved
    "description": "Inventory valuation by item and commodity",
    "keywords": ["inventory", "valuation", "stock value"],   // routing hints (phrases allowed)
    "examples": ["Show inventory valuation for last month"],
    "permissions": [],                      // extra permissions for this capability
    "input_schema": { "...": "JSON Schema, validated by the platform before calling you" },
    "output_schema": null,
    "internal": false
  }],
  "permissions": ["inventory.read"],        // user must hold all of these (wildcards like inventory.* granted)
  "tools": ["inventory-summary"],
  "tenants": ["*"],                         // or explicit tenant ids
  "priority": 100,                          // higher wins among healthy candidates
  "timeout_seconds": 20,
  "idempotent": true,                       // false ⇒ platform will not retry
  "max_concurrency": null,                  // return 429 above this; platform retries elsewhere/later
  "owner": "supply-team@example.com",
  "tags": [], "metadata": {}
}
```

## AgentRequest (platform → agent)

```json
{
  "request_id": "…", "agent_id": "inventory-agent", "agent_version": "1.1.0",
  "capability": "inventory.valuation.read", "step_id": "s1",
  "input": {"message": "Show inventory valuation for last month", "...": "mapped inputs"},
  "previous_results": {"s0": {"...": "outputs of direct dependencies"}},
  "context": {
    "request_id": "…", "execution_id": "exec_…", "conversation_id": "…",
    "user": {"user_id": "alice", "tenant_id": "acme", "roles": [], "permissions": ["inventory.read"]},
    "messages": [{"role": "user", "content": "…"}], "variables": {}, "knowledge_contexts": [], "metadata": {}
  },
  "idempotency_key": "exec_…:s1", "attempt": 1, "deadline_seconds": 20,
  "context_token": "<opaque; send back as X-Platform-Context>"
}
```

## AgentResult (agent → platform)

```json
{
  "status": "success",                      // success | partial | error
  "output": {"summary": "One-sentence answer shown to the user", "rows": [...], "total_value": 1250000},
  "artifacts": [
    {"type": "metric", "title": "Total inventory value", "value": 1250000, "format": "currency", "currency": "USD"},
    {"type": "table", "title": "…", "columns": [{"field": "item", "label": "Item", "data_type": "string"}], "rows": [...]},
    {"type": "chart", "title": "…", "chart_type": "bar", "x": "commodity", "y": ["value"], "data": [...]}
  ],
  "citations": [], "metadata": {}, "usage": {"total_tokens": 0},
  "error": null                              // or {"code","message","category","retryable","details"}
}
```

Conventions that make agents compose well:

* Put a human sentence in `output.summary`.
* Put tabular data in `output.rows` and a headline number in `output.total_<measure>` — the
  built-in aggregator and chart builder use these generically (e.g. joining two agents on a
  shared string column such as `commodity`).
* Business errors → HTTP 200 with `status: "error"`; set `retryable: true` only for transient
  failures. HTTP 5xx/timeouts are treated as `AGENT_UNAVAILABLE` (retried, failover).
* HTTP 422 for invalid input, 429 when at `max_concurrency`.
