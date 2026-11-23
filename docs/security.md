# Security model

| Threat | Control | Where |
|---|---|---|
| Unauthenticated access | Bearer auth on every user endpoint; OIDC/JWT (JWKS, issuer, audience, expiry) or static API tokens | `ai_security/auth.py` |
| Cross-tenant data access | Tenant comes only from the credential; conversations, executions, documents, retrieval and agent catalog are tenant-filtered; agents can be tenant-scoped | services, stores, registry |
| Privilege escalation via the LLM | LLM output is restricted to registered capabilities; every step needs an explicit allow decision from the policy engine | resolver, validator, `policy.py` |
| Excessive agency | Permissions per agent and per capability; tools check the *user's* permissions; tenant allow/deny lists; step limits | `PolicyEngine`, `ToolBox` |
| Rogue agent registration | Registration token (shared or per-agent), host allow-list, reserved `platform-` IDs and `platform.` capabilities, manifest validation | `routers/agents.py` |
| Forged/replayed calls to agents | Bearer service token + HMAC-SHA256 body signature with 5-minute window; idempotency keys | `signing.py`, SDK |
| Agents abusing platform services | Callbacks require the registration token **and** a short-lived platform-signed context token bound to tenant/user/execution | `routers/agent_services.py` |
| Prompt injection | Heuristic guardrail (flag or block), audit of findings, message size limits; data access only via semantic tools | `guardrails.py` |
| Secrets exposure | LLM keys live only in the platform; agents never receive them; secrets are `SecretStr`; production gate rejects defaults | `config.py` |
| SSRF via service URLs | `ALLOWED_AGENT_HOSTS`; NetworkPolicy in Kubernetes | config, `deploy/k8s` |
| Abuse / DoS | Per-user token-bucket rate limiting, per-agent concurrency limits (429), circuit breakers, timeouts | `ratelimit.py`, runtime |
| Repudiation | Persistent audit log with actor, tenant, request and execution IDs | `audit.py` |
| Unsafe conditions in plans | AST-whitelisted expression evaluator (no `eval`, no attribute access) | `mapping.py` |

Recommended in production, outside the code: TLS everywhere (or mTLS via a service mesh),
secrets from a vault with rotation, `GUARDRAIL_MODE=block` for externally exposed tenants, a
model-based injection classifier as an additional `Guardrail`, and log shipping to a SIEM.
