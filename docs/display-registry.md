# Display registry

A separate service on the platform's database that stores, for each front-end application, which **modules**,
**displays** and **menu entries** exist, and serves each signed-in user the menu they are allowed to see.

It is generic: GridTrade is the first application, but nothing in the service knows about it. Each application
keeps its own users, roles and permissions; the registry only checks the application's signed tokens and asks
the application which permission names exist.

```
browser ── /api/*  ───────────────▶ application backend   (sign-in, business APIs, permissions: authoritative)
        └─ /registry/api/v1/* ────▶ display registry      (menus and display metadata, filtered per user)
                                        │
                                        └── platform database (registry_* tables, Alembic 0002)
developer / pipeline ── agentctl display register ──▶ registry (after signing in to the application)
```

## Run it

```bash
pip install -e .                      # the display-registry command comes with the platform
export DATABASE_URL=sqlite+aiosqlite:///./data/platform.db      # or PostgreSQL in production
export DISPLAY_REGISTRY_APPS_FILE=deploy/display-registry.apps.json
export GT_JWT_SECRET=...              # the variable the app config names (secretEnv)
alembic upgrade head                  # production; in development the tables are created on start
display-registry                      # http://127.0.0.1:8130  (DISPLAY_REGISTRY_HOST / _PORT)
```

Application config (`DISPLAY_REGISTRY_APPS` inline JSON, or a file):

```json
{
  "gridtrade": {
    "title": "GridTrade",
    "issuer": "gridtrade", "audience": "gridtrade-app",
    "secretEnv": "GT_JWT_SECRET",
    "permissionCatalogUrl": "http://localhost:5080/api/permissions",
    "registerPermission": "displays.register"
  }
}
```

`jwksUrl` replaces `secretEnv` for an identity provider that signs with RS256 (Entra ID, Okta, Keycloak).
The catalog may return a list of names, `{ "permissions": [...] }`, a `{ data }` envelope, or GridTrade's
`[{ module, actions }]` groups.

## Manifest (contract v1)

One JSON file per module, kept in the application's `registration/` folder. Print the JSON Schema with
`display-registry schema` or `GET /api/v1/schema/module-manifest`.

```json
{
  "schemaVersion": 1,
  "app": "gridtrade",
  "module": { "id": "gridtrade.reference", "version": "1.0.0", "title": "Reference Data" },
  "displays": [
    { "id": "reference.counterparties", "title": "Counterparties", "type": "summary", "key": "CounterpartySummary",
      "route": "reference/counterparties", "requiredPermissions": ["reference.view"],
      "actionPermissions": { "create": "reference.edit", "update": "reference.edit", "delete": "reference.delete" } },
    { "id": "reference.counterparty", "title": "Counterparty", "type": "entry-form", "key": "CounterpartyEntry",
      "params": [{ "name": "id", "required": true }], "requiredPermissions": ["reference.view"] }
  ],
  "menus": [
    { "id": "reference.counterparties", "title": "Counterparties", "parent": "reference",
      "display": "reference.counterparties", "sortOrder": 10 }
  ]
}
```

| Field | Meaning |
|---|---|
| `display.id` / `menu.id` | stable lower-case keys; titles can change, ids do not |
| `display.type` | `entry-form`, `summary`, `master-slave`, `custom`, or a type the app adds in `displayTypes` |
| `display.key` | the implementation key in the front-end's approved registry (`displays.ts`); the database never holds code |
| `display.route` | deep-link path, default `d/<id>` (unique per app) |
| `display.openMode` | `tab` (default), `window` (modal) or `page` |
| `display.params` | values the display needs, e.g. a record `id` (`'new'` to create) |
| `display.requiredPermissions` | all needed to see or open it |
| `display.actionPermissions` | action → permission; the user's result is sent as `actions` (a UI hint: the API still enforces) |
| `display.config` | template settings, or `xtype` / `screenKey` for screens on the Ext JS compatibility runtime |
| `menu.parent` | a folder (an entry without `display`); folders nest |
| `menu.params` / `menu.action` | passed to the display, e.g. `{ "id": "new" }` or `"action": "new"` |
| `menu.requiredPermissions` | extra permissions for this entry only (e.g. "New Trade" needs `trades.edit`) |

## API

All endpoints need `Authorization: Bearer <application token>`.

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/apps/{app}/navigation` | any signed-in user: their menu tree and the metadata of displays they may open |
| GET | `/api/v1/apps/{app}/displays/{id}` | 403 when not permitted, 404 when unknown or disabled |
| POST | `/api/v1/apps/{app}/modules/validate` | `registerPermission`: check a manifest, change nothing |
| POST | `/api/v1/apps/{app}/modules/register` | `registerPermission`: `{ manifest, dryRun?, prune?, overrideAdminChanges? }` |
| GET | `/api/v1/apps/{app}/modules[/{module}]` | `registerPermission`: registered modules, items and history |
| PATCH | `/api/v1/apps/{app}/displays/{id}`, `/menus/{id}` | `adminPermission`: enable/disable, permissions, order, title, parent |

## Registration rules

- **Validated twice.** Locally by `agentctl display validate`, and by the registry against the database and the
  application's permission catalog: unknown permissions, display types, parents and displays are rejected, as
  are parent cycles, route clashes and missing required parameters.
- **Idempotent.** The same manifest again reports `unchanged` and writes nothing.
- **Ownership.** A module owns what it registered; another module using the same id is rejected.
- **Versions.** A version may not go down. Changing content without a version bump is allowed but reported.
- **Administrators win.** Fields changed through PATCH are recorded in `admin_overrides` and kept by later
  registrations unless `--override-admin-changes` is given.
- **Nothing is deleted.** Entries a module stops declaring are kept, or disabled with `--prune`.
- **One transaction** per manifest, with a history row (who, when, version, checksum, changes).
- **Never automatic.** Registration runs from the CLI or a deployment step, never when a browser starts.

```bash
agentctl display validate registration/*.manifest.json
agentctl display register registration/gridtrade.core.manifest.json registration/gridtrade.reference.manifest.json \
    --registry http://localhost:8130 --app-api http://localhost:5080/api --user admin [--dry-run] [--prune]
agentctl display status gridtrade.reference --app gridtrade --registry ... --app-api ... --user admin
```

The password is prompted, or read from the variable named by `--password-env`; pipelines can pass a token
with `--token-env`.

## Security notes

- Hiding a menu entry is not authorization. The registry filters menus and display metadata, and the
  application's API enforces its own permissions on every call.
- The front-end maps display keys to bundled code through an explicit registry, so a database record cannot
  load arbitrary code.
- Permissions in the token are refreshed with the token (30 minutes by default in GridTrade); revoking access
  takes effect on the application's API immediately and on the menu at the next refresh.
