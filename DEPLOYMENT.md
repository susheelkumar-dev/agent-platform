# Deployment runbook: AI lab on free tiers

Four repositories, three hosts, one database. Every service below has a permanent free tier; nothing here
needs a paid add-on.

| Layer | Repo | Runs on | Public URL |
|---|---|---|---|
| UI + BFF (ASP.NET Core 8 + React) | `portfolio` | MonsterASP.NET (IIS, 256 MB) | `https://<you>.runasp.net/lab` |
| Multi-agent service (FastAPI + LangGraph) | `agent-platform` (`agent-service/`) | Azure Container Apps | called only by the BFF |
| GridTrade demo API (Node) | `gridtrade-extjs` | Azure Container Apps | called only by the BFF |
| Migrated React app (static) | `gridtrade-react` | built into the portfolio | `/lab/gridtrade/` |
| Agent checkpoints | | Neon PostgreSQL | |

```
Browser ──► MonsterASP.NET (portfolio)
             ├─ /lab, /admin                React (wwwroot)
             ├─ /lab/gridtrade/             migrated GridTrade app (wwwroot/lab/gridtrade)
             ├─ /api/lab/agent/*  ─ SSE ──► agent-service  (X-Internal-Api-Key, X-User-Id) ──► Neon
             │                                    └──────► gridtrade-api (service account, approvals)
             ├─ /lab/gridtrade/api/* ─────► gridtrade-api  (the visitor's own GridTrade token)
             └─ /lab/gridtrade/registry/*   menus: GridTrade manifests + displays built in /admin (SQL Server)
```

Order: 1 Neon → 2 container images → 3 Azure Container Apps (or 3b Render) → 4 CI/CD → 5 MonsterASP → 6 checks.

---

## 0. Secrets to generate first

Generate each once and keep them in a password manager. Each value is used in two places, which must match.

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"   # run 3 times
```

| Name | Used by | Must equal |
|---|---|---|
| `INTERNAL_API_KEY` | agent-service | portfolio `Lab:AgentService:InternalApiKey` |
| `GT_JWT_SECRET` (32+ chars) | gridtrade-api | portfolio `Lab:GridTrade:JwtSecret` |
| `GT_SEED_PASSWORD` | gridtrade-api: every seeded user except the public one | agent-service `GRIDTRADE_PASSWORD` (it signs in as `ops.analyst`) |
| `GT_SEED_PASSWORDS` = `{"auditor":"<public demo password>"}` | gridtrade-api | portfolio `Lab:GridTrade:DemoPassword` (shown on /lab on purpose) |

LLM keys (all free tiers, at least one): Groq `https://console.groq.com/keys`, Google AI Studio
`https://aistudio.google.com/apikey`, OpenRouter `https://openrouter.ai/settings/keys`. Free tiers have rate and daily
limits; the service falls back to the next provider when one fails, and the portfolio limits each visitor IP
(`Lab:AgentRunsPerWindow`, default 12 per 10 minutes).

---

## 1. Neon PostgreSQL (checkpoints)

1. Sign in at `https://console.neon.tech`, **New project** (Postgres 17, the region closest to your Azure region).
2. **Connect** > copy the **pooled** connection string. It looks like
   `postgresql://neondb_owner:...@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require`.
   The service turns prepared statements off, so the pooled (PgBouncer) endpoint is fine.
3. Create the tables once to prove the string works (from `agent-platform/agent-service`, Linux/macOS or WSL;
   the service also does this on every start):

   ```bash
   python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
   DATABASE_URL='postgresql://...?sslmode=require' python -m agentsvc.init_db
   # ready: agent_threads, checkpoint_blobs, checkpoint_migrations, checkpoint_writes, checkpoints
   ```

Neon suspends the compute when idle; the first query after that wakes it in about a second. Nothing else to do.

---

## 2. Container images (GitHub Container Registry, free)

Push the repos to GitHub; the workflows build and push the images on every push to `main`:

| Repo | Workflow | Image |
|---|---|---|
| agent-platform | `.github/workflows/agent-service.yml` | `ghcr.io/<owner>/agent-service` |
| gridtrade-extjs | `.github/workflows/api.yml` | `ghcr.io/<owner>/gridtrade-api` |

After the first run, open each package on GitHub (Your profile > Packages > the package > Package settings) and set
**visibility: Public**, so Azure pulls it without registry credentials. (Azure Container Registry has no free tier;
GHCR is free for public images.)

To build locally instead: `docker build -t agent-service ./agent-service` and `docker build -t gridtrade-api .`
in the respective repo.

---

## 3. Azure Container Apps (Consumption plan)

The Consumption plan includes a monthly free grant per subscription (180,000 vCPU-seconds, 360,000 GiB-seconds and
2 million requests at the time of writing). Two apps at 0.25 vCPU / 0.5 GiB that scale to zero fit in it for a
portfolio's traffic. **Set a budget alert first** (Cost Management > Budgets, e.g. USD 1) since the subscription
also hosts your Azure OpenAI proof of concept.

Run in **Azure Cloud Shell** (portal toolbar > `>_` > Bash): `az` is already installed and signed in.

```bash
RG=rg-ai-lab
LOC=westeurope            # pick the region nearest MonsterASP's data centre and your Neon region
ENVNAME=cae-ai-lab
OWNER=<your-github-user>  # lower case

az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App --wait
az group create -n $RG -l $LOC
# no Log Analytics workspace: it is billed by ingestion; use `az containerapp logs show` instead
az containerapp env create -n $ENVNAME -g $RG -l $LOC --logs-destination none
```

### 3.1 gridtrade-api

```bash
az containerapp create -n gridtrade-api -g $RG --environment $ENVNAME \
  --image ghcr.io/$OWNER/gridtrade-api:latest --target-port 8080 --ingress external \
  --min-replicas 0 --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
  --secrets gt-jwt='<GT_JWT_SECRET>' gt-seed='<GT_SEED_PASSWORD>' gt-seeds='{"auditor":"<public demo password>"}' \
  --env-vars GT_JWT_SECRET=secretref:gt-jwt GT_SEED_PASSWORD=secretref:gt-seed GT_SEED_PASSWORDS=secretref:gt-seeds

GT_URL=https://$(az containerapp show -n gridtrade-api -g $RG --query properties.configuration.ingress.fqdn -o tsv)
curl -s $GT_URL/api/health     # {"success":true,"data":{"status":"ok",...}}
```

`max-replicas 1` matters: the demo database lives in the container, and one replica keeps every visitor on the
same data. It reseeds whenever the app scales to zero and starts again.

### 3.2 agent-service

```bash
az containerapp create -n agent-service -g $RG --environment $ENVNAME \
  --image ghcr.io/$OWNER/agent-service:latest --target-port 8000 --ingress external \
  --min-replicas 0 --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
  --secrets internal-key='<INTERNAL_API_KEY>' db-url='<Neon pooled URL>' \
            groq='<GROQ_API_KEY>' google='<GOOGLE_API_KEY>' openrouter='<OPENROUTER_API_KEY>' gt-pass='<GT_SEED_PASSWORD>' \
  --env-vars ENVIRONMENT=production INTERNAL_API_KEY=secretref:internal-key DATABASE_URL=secretref:db-url \
             GROQ_API_KEY=secretref:groq GOOGLE_API_KEY=secretref:google OPENROUTER_API_KEY=secretref:openrouter \
             GRIDTRADE_API_URL=$GT_URL/api GRIDTRADE_USER=ops.analyst GRIDTRADE_PASSWORD=secretref:gt-pass

AGENT_URL=https://$(az containerapp show -n agent-service -g $RG --query properties.configuration.ingress.fqdn -o tsv)
curl -s $AGENT_URL/health      # {"status":"ok",...}   (the first call after idle takes a cold start)
curl -s $AGENT_URL/ready       # {"status":"ready","db":true,"providers":["groq","gemini","openrouter"]}
curl -s -o /dev/null -w "%{http_code}\n" -X POST $AGENT_URL/api/v1/agent/stream   # 401: the key is enforced
```

Leave out a provider you have no key for (drop its `--secrets` and `--env-vars` entries). In production the
service refuses to start without `INTERNAL_API_KEY`, `DATABASE_URL` and at least one provider key; see
`az containerapp logs show -n agent-service -g $RG --follow` if a revision does not become healthy.

Memory: the service measured about 136 MB resident with all three providers loaded, well inside 0.5 GiB.
Streams: the agent sends an SSE keep-alive comment every 15 s, so an idle connection never sits silent long
enough for the ingress to close it.

### 3.3 Optional: LangSmith tracing

Add `--secrets langsmith='<key>'` and `--env-vars LANGSMITH_API_KEY=secretref:langsmith` (free developer plan).

---

## 3b. Alternative: Render (free, no card)

Each repo has a `render.yaml`. In Render: **New + > Blueprint**, pick the repo; it builds the Dockerfile, injects
`$PORT` and checks the health path. Enter the secrets it asks for (same values as above;
`GRIDTRADE_API_URL=https://gridtrade-api-xxxx.onrender.com/api`). The free plan sleeps after about 15 minutes idle
and wakes on the next request (30-60 s); the portfolio shows "Waking up the multi-agent engine…" meanwhile.

---

## 4. CI/CD (GitHub Actions → Azure, no stored Azure password)

The deploy jobs log in with OpenID Connect. Once, in Cloud Shell:

```bash
SUB=$(az account show --query id -o tsv)
APP_ID=$(az ad app create --display-name gh-ai-lab-deploy --query appId -o tsv)
az ad sp create --id $APP_ID >/dev/null
az role assignment create --assignee $APP_ID --role Contributor --scope /subscriptions/$SUB/resourceGroups/$RG
for repo in agent-platform gridtrade-extjs; do
  az ad app federated-credential create --id $APP_ID --parameters "{\"name\":\"$repo-production\",
    \"issuer\":\"https://token.actions.githubusercontent.com\",
    \"subject\":\"repo:$OWNER/$repo:environment:production\",\"audiences\":[\"api://AzureADTokenExchange\"]}"
done
echo "AZURE_CLIENT_ID=$APP_ID  AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)  AZURE_SUBSCRIPTION_ID=$SUB"
```

In **each** of the two repos on GitHub: Settings > Environments > **New environment** `production`; Settings >
Secrets and variables > Actions: secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and the
variable `AZURE_RESOURCE_GROUP=rg-ai-lab`. From then on a push to `main` tests, builds, pushes and rolls the app.
Without the variable the deploy job is skipped and the build still runs.

`gridtrade-react`: push a tag (`git tag v1.0.0 && git push --tags`) to publish `gridtrade-react-portfolio.zip` as a
release asset for the portfolio.

---

## 5. MonsterASP.NET (portfolio)

Steps in `portfolio/LAB.md`. In short:

1. On the server's `appsettings.json` (gitignored; edit it in the MonsterASP file manager or publish it once), add the
   `Lab` section from `appsettings.Example.json` with `$AGENT_URL`, `$GT_URL` and the shared secrets.
2. Locally: `scripts\stage-gridtrade.ps1 -Repo <owner>/gridtrade-react` (or `-From <dist>`), then
   `cd portfolio-client; npm run build`.
3. Publish with the existing Web Deploy profile. The app applies the `LabDisplays` migration on start.

IIS notes, already handled in the code:

* `web.config` uses **in-process** hosting (one w3wp process). In that mode the `aspNetCore requestTimeout`
  attribute is not used (it applies to out-of-process hosting only), so there is nothing to tune there; long streams
  stay open because of the 15 s keep-alives.
* Dynamic compression is switched off for `/api/lab/agent` in `web.config`; compression would buffer SSE.
* `AgentProxyController` calls `IHttpResponseBodyFeature.DisableBuffering()`, reads upstream with
  `HttpCompletionOption.ResponseHeadersRead` and flushes every chunk.
* Workstation, non-concurrent GC and `System.GC.ConserveMemory` keep the process small; the lab adds two pooled
  HttpClients and no background threads.

---

## 6. Checks after deploying

```bash
SITE=https://<you>.runasp.net
curl -s $SITE/api/health                    # ok: true, no pending migrations
curl -s $SITE/api/lab/info                  # agentsEnabled / gridTradeEnabled: true
# tokens must arrive one by one; if everything appears at once, something in front of IIS is buffering
curl -sN -X POST $SITE/api/lab/agent/stream -H 'Content-Type: application/json' -d '{"message":"What is this lab?"}'
curl -s -o /dev/null -w "%{http_code}\n" $SITE/lab/gridtrade/        # 200
```

Then in a browser: `/lab` → ask "Which trades are New? Confirm the first one." → an approval card appears →
Approve → the trade is Confirmed. `/admin` → Display Builder → create a display → it shows in the preview (draft,
only for you) → publish → it appears under "Built in the portfolio" in `/lab/gridtrade/` and on `/lab`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/lab` says the agent service is switched off | `Lab:Enabled`, `BaseUrl` or `InternalApiKey` (24+ chars) missing on MonsterASP |
| "The lab is misconfigured" | the two `INTERNAL_API_KEY` values differ |
| Waking-up notice, then an error after 90 s | cold start + Neon wake took longer: raise `Lab:AgentService:ConnectTimeoutSeconds` |
| GridTrade menu empty / sign-in loops | `Lab:GridTrade:JwtSecret` differs from the container's `GT_JWT_SECRET` |
| "A model provider is busy" | free-tier rate limit on every configured provider; add another provider key or wait |
| Revision unhealthy on Azure | `az containerapp logs show -n agent-service -g rg-ai-lab` shows which setting is missing |

### Model names on free tiers

Providers retire free models without notice (on 2026-11-23 Groq had removed `llama-3.3-70b-versatile` and Google had
closed `gemini-2.5-flash` to new users). A retired model shows as `NotFoundError` / `model_not_found` in
`az containerapp logs show`. Fix it without a rebuild:

```bash
az containerapp update -n agent-service -g rg-ai-lab \
  --set-env-vars GROQ_MODEL=<id> GEMINI_MODEL=<id> OPENROUTER_MODEL=<id>:free
```

Current ids: Groq `GET https://api.groq.com/openai/v1/models`, Gemini `GET .../v1beta/models?key=...`,
OpenRouter `https://openrouter.ai/models?max_price=0` (pick one that supports tools).
