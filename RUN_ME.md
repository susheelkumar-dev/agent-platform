# Run the AI Agent Platform

Follow these steps on Windows, in order. Setup is already done on this machine, so you can start at step 1.

## 1. Open PowerShell in this folder

Open PowerShell normally (Start > PowerShell). Do **not** use "Run as administrator": the scripts refuse to run there.

```powershell
cd D:\ExtJsToReactTool\ai-agent-platform
```

## 2. Start it

Pick one option.

**Option A: platform only** (the chat UI and the Ext JS migration agent)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Only platform
```

**Option B: platform and GridTrade** (also the GridTrade API, display registry and React app)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -WithPlatform
```

Starting stops anything an earlier run left running, so it is safe to run again at any time. The services keep running in the background after the command finishes, and your browser opens when it is done.

## 3. Open the app

| What | URL | Sign in | Started by |
|---|---|---|---|
| Platform chat | http://127.0.0.1:8000/ | Pick `demo-admin` in the identity list | A and B |
| Migration agent health check | http://127.0.0.1:8120/health | None | A and B |
| GridTrade React app | http://localhost:5173/ | `admin` / `GridTrade#2026` (development password) | B only |
| GridTrade API health check | http://127.0.0.1:5080/api/health | None | B only |
| Display registry health check | http://127.0.0.1:8130/health | None | B only |

## 4. Check it is working

Open the platform's readiness URL:

http://127.0.0.1:8000/ready

You should see:

```json
{"status":"ready","database":true}
```

## 5. Stop it

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1
```

This stops everything the start script started, whichever option you used.

---

## Analyze or migrate an Ext JS app from the chat

1. In the identity list at the bottom left of the chat page, pick **demo-admin**. The page's other identities do not have the migration permissions.
2. Use the real folder path in your message. The `/work/gridtrade/web` path in the agent's examples does not exist on this machine.

Analyze (reads only):

```text
Analyze the Ext JS app in D:\ExtJsToReactTool\gridtrade-contracts-extjs\web
```

Migrate (writes files):

```text
Migrate the Ext JS app in D:\ExtJsToReactTool\gridtrade-contracts-extjs\web to React
```

The output goes to a new folder under `D:\ExtJsToReactTool\migrations`, not to `gridtrade-react`. Add the word "framework" to use the framework shell, or "build" to also run a build check.

The agent can only read and write under the folders set in `agents\extjs-migration-agent\.env` (`EXTJS_MIGRATE_ROOTS` and `EXTJS_MIGRATE_OUTPUT`). If you move or copy this workspace, update both, then stop and start again.

---

## Good to know

- **Mock AI responses:** `.env` has `LLM_PROVIDER=mock`, so no real AI model is called. To use one, set `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` in `.env`, then stop and start again.
- **Demo questions:** the inventory and exposure examples in `README.md` need two sample agents that these commands do not start. See the quick start in `README.md`.
- **UI Forge (optional):** add `-WithBuilder` to the start command in step 2 to also run the display builder on http://127.0.0.1:8140/. It needs the GridTrade React app in `..\gridtrade-react`.

## If something goes wrong

Logs are in `D:\ExtJsToReactTool\.local-run`. Each service has a `.log` and an `.err.log` file, for example `platform.err.log` and `migration-agent.err.log`. The platform and the agent write their normal startup messages to `.err.log` too, so text there is not always an error.

| Problem | What to do |
|---|---|
| "must not run from an Administrator window" | Close the window and open PowerShell normally. |
| "No .venv yet" or a tool "is not installed in .venv" | Run the first-time setup below. |
| "Port ... is still in use" | Run the stop command in step 5 and try again. If it still fails, end the listed process in Task Manager (Details tab) or restart Windows. |
| "No React app at ..." or "GridTrade not found at ..." | Option B needs `gridtrade-react` and `gridtrade-contracts-extjs` next to this folder. Use option A, or run the first-time setup below. |
| "denied: missing permissions: migration.read" | Pick `demo-admin` in the chat's identity list. |
| "is outside the folders this agent may read" | Use a path under `EXTJS_MIGRATE_ROOTS`, or update that setting in `agents\extjs-migration-agent\.env`, then stop and start again. |
| A page does not load | Check the service's `.err.log` file, then stop and start again. |
| Not sure what is wrong | Run `powershell -ExecutionPolicy Bypass -File scripts\check-prereqs.ps1`. It lists each problem and how to fix it. |

## First-time setup (new machine only)

You need Python 3.11 or later and Node.js 18 or later, with `gridtrade-contracts-extjs` next to this folder.

Double-click `setup-and-run.bat` in this folder. It checks prerequisites, sets up Python, runs the tests, converts GridTrade to React the first time, and starts the GridTrade services and UI Forge.

That file does not start the platform chat. Once it finishes, use step 2 above to start it.
