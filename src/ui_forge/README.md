# UI Forge — the metadata-driven display builder

UI Forge designs **Summary**, **Entry** and **Master-Slave** displays for React apps that the Ext JS migration agent
produces (`extjs-migrate ... --shell framework`), and turns each design into real, maintainable code in that app:

* a **visual builder** (drag and drop, inspector, undo/redo, live preview with the app's own framework, code and
  schema views, plan/diff/apply),
* a **versioned JSON schema** (entities + displays) stored in the app repository, validated against the app itself,
* **deterministic, safe generation** (generated vs. developer-owned files, lock file, plan hash, conflict detection,
  backups, orphan clean-up),
* **backend scaffolding** for the app's API that enforces permissions on the server, with generated API tests,
* **menu and route integration** through the display registry, the same way migrated displays are registered,
* a **CLI** for CI and scripted use.

It does not invent a parallel architecture: generated displays are `createSummaryDisplay` /
`createEntryDisplay` / `createMasterSlaveDisplay` from `@extreact/framework`, registered in `src/displays.ts`,
listed in a registry manifest like every other module, and served by routes in the app's own API style.

---

## Contents

1. [Quick start](#1-quick-start)
2. [How it fits together](#2-how-it-fits-together)
3. [The builder, screen by screen](#3-the-builder-screen-by-screen)
4. [Display types](#4-display-types)
5. [Permissions and security](#5-permissions-and-security)
6. [What gets generated](#6-what-gets-generated)
7. [Writing business logic (hooks)](#7-writing-business-logic-hooks)
8. [Safe regeneration](#8-safe-regeneration)
9. [Backend integration](#9-backend-integration)
10. [Schema reference](#10-schema-reference)
11. [CLI reference](#11-cli-reference)
12. [Service API](#12-service-api)
13. [Configuration](#13-configuration)
14. [The example: GridTrade assets](#14-the-example-gridtrade-assets)
15. [Testing and what was verified](#15-testing-and-what-was-verified)
16. [Integration checklist](#16-integration-checklist)
17. [Troubleshooting](#17-troubleshooting)
18. [Limitations and roadmap](#18-limitations-and-roadmap)
19. [Working on UI Forge itself](#19-working-on-ui-forge-itself)

---

## 1. Quick start

Prerequisites: the platform set up (`scripts\setup-local.ps1`), GridTrade migrated to React with the framework shell
(`scripts\migrate-gridtrade.ps1`), Node.js 20+ and Python 3.11+.

### Windows (PowerShell)

```powershell
cd D:\AI-Imp\ai-agent-platform
scripts\start-local.ps1 -WithBuilder          # API :5080, registry :8130, React app :5173, UI Forge :8140
# or only the builder (start the rest first for live data and registration):
scripts\start-local.ps1 -Only builder
scripts\stop-local.ps1                        # stops everything started by start-local
```

Open **http://127.0.0.1:8140/**. Sign in to GridTrade from *Preview → Live API* (admin / the development password
`GridTrade#2026`, unless you changed it) when you want live data, registration or "Read fields from the API".

### macOS / Linux, or by hand

```bash
cd ai-agent-platform
.venv/bin/ui-forge --app ../gridtrade-react serve      # http://127.0.0.1:8140 (front end + API contracts)
# add --api ../gridtrade-contracts-extjs only to let it generate GridTrade's Node API routes as well
```

### Try the example in one minute

```bash
ui-forge --app ../gridtrade-react \
         import src/ui_forge/examples/gridtrade-assets.json
ui-forge ... plan --diff      # review
ui-forge ... stage assets.asset-outages   # code + README in gridtrade-react/ui-forge-out/assets.asset-outages/ (review, copy in yourself)
ui-forge ... apply            # or write straight into the project (asks first; --yes to skip)
ui-forge ... test --build        # --api too when an API folder is configured
ui-forge ... register --user admin --password-env GT_ADMIN_PASSWORD
```

Restart the GridTrade API after generating backend code (it loads `server/generated` at start-up), then open the
React app: the **Assets** menu has *Generation Assets*, *New Generation Asset* and *Asset Outages*.

---

## 2. How it fits together

```
 Ext JS app ──extjs-migrate --shell framework──▶  React app (gridtrade-react)
                                                   ├─ package.json             depends on @extreact/framework + /runtime (packages)
                                                   ├─ src/displays.ts          approved implementations  ◀── UI Forge wires a marked block
                                                   ├─ src/modules/<module>/
                                                   │    ├─ ui-forge/*.entity.json, *.display.json     ◀── the design (source of truth)
                                                   │    ├─ types/ services/ *.schema.generated.ts      ◀── generated
                                                   │    └─ displays/<folder>/
                                                   │         ├─ *.config.generated.ts                  ◀── generated
                                                   │         ├─ <Name>.tsx, *.hooks.ts                 ◀── yours (created once)
                                                   ├─ src/modules/generated-displays.ts                ◀── generated registry
                                                   ├─ registration/<app>.ui-forge.<module>.manifest.json ◀── generated (menus, permissions)
                                                   └─ ui-forge.lock.json                               ◀── what UI Forge wrote
                                                   ├─ src/modules/<module>/api/<entity>.api.md         ◀── generated API contract for the backend team
 GridTrade API (gridtrade-contracts-extjs/server) — only with --api (-BuilderBackend in start-local.ps1)
   ├─ security.js / server.js / db.js   a small seam that loads generated modules (see §9)
   └─ generated/  *.routes.generated.js, index.js, forge-runtime.js, selftest.generated.js  ◀── generated
                  *.hooks.js                                                                 ◀── yours
 Mirror (optional, --mirror)                   a second copy of the app-files extjs-migrate copies in: every src/modules, registration
                                               and src/displays.ts change is written here too, so re-migrating keeps it.
 Display registry (:8130)  serves menus filtered by the signed-in user's permissions; manifests are registered into it.
```

**Source of truth**: the JSON documents under `src/modules/<module>/ui-forge/`. They are small, diff-friendly,
versioned (`schemaVersion: "1.0"`, `revision` bumped on every saved change) and reviewed like code. Everything
marked *generated* can be deleted and regenerated byte-for-byte from them.

**Roots**: UI Forge only ever writes inside the configured roots (`app`, `api`, `mirror`); every path is checked
(`..` and absolute paths are refused).

---

## 3. The builder, screen by screen

### Home
* **UI Forge displays** grouped by module, with type, revision, menu entry and error count. Click to open; the
  trash icon deletes the display's schema (see [§8 deleting](#deleting-displays-and-entities)).
* **Entities** with how many displays use them; unused entities can be deleted.
* **Other displays in the app**: migrated and hand-written displays read from `registration/*.manifest.json`.
  New ids, routes and menu entries are checked against these.
* **Project facts**: roots, backend kind, registry, number of menu entries / permission modules / lookups found.

### New display wizard
1. **Kind** — Summary, Entry or Master-Slave.
2. **Data** — a *new entity* (name, module, API path, generate the API or use an existing one; start with Code +
   Name, Name only, or **Read from the API**: reads up to 50 records from an existing endpoint and proposes fields,
   types, enum options and required flags) or an *existing entity*. Master-Slave adds the detail: *same record*
   (grid + form editing the selected row) or *child records* (a new or existing child entity with a link field).
3. **Menu & access** — title, menu folder (the app's real menu tree), optional new folder, and permissions: a new
   permission module (`<module>.view/.edit/.delete`, granted once to `admin`) or existing permissions.
   For Summary/Entry, **"Also create the matching Entry form / Summary grid"** creates and links the pair
   (New/Open on the grid opens the form; Close on the form returns to the grid).
4. **Review** — what will be created. Nothing is written to generated code until you Save and Generate.

### Design
* **Left rail**
  * **Controls** — 35 controls in seven groups: text (text box, text area, heading, help text), numbers (whole,
    decimal, currency), date & time, choices (dropdown, combo/lookup, multi-select, radio, checkbox, switch),
    layout (panel, field group, tab, plain area), data (grid features), actions (Save, Delete, Copy,
    Audit/History, Reset, Cancel/Close, New, Open, Refresh, Custom). **Drag** onto the canvas, or **click** to add
    next to the current selection (keyboard friendly).
  * **Fields** — the data model of every entity in the display. Drag a field onto the form, the grid header or the
    search panel; double-click to place it; an orange dot marks fields not placed yet. "Add a field (data only)"
    adds to the model without placing.
  * **Outline** — every section, field, column, search field and action as a tree; click to select.
  * **Menu** — the app menu with this display highlighted.
* **Canvas** — light "paper" that looks like the app:
  * Entry: sections (panel / field group / tab / plain) in an N-column grid. Drag fields within and between
    sections; drag a field's **right edge** to change its column span; drag section headers to reorder; drop slots
    light up only where the dragged thing is allowed.
  * Summary: search panel chips (operator shown), toolbar, column headers (drag to reorder, **drag the edge to
    resize**), sample rows rendered by type (badges, booleans, currency), paging footer, row menu.
  * Master-Slave: master grid and detail (child list + form) side by side or stacked; **drag the splitter**
    (or focus it and use the arrow keys) to set the split; the link field is shown as a chip.
* **Inspector** — properties of the selection: display (identity, route, open mode, form columns, permissions and
  the action-permission table, generator switches, entities), menu (title, folder picker, order, params, extra
  permissions, new folders), section, form field (width, widget, label, placeholder, help, read-only,
  locked-after-create, hidden, conditional visibility, validator name) **and the entity field it uses** (name,
  type, required, unique, lengths, pattern, range, decimals, currency, options, lookup, default, read-only,
  example), column (header, fixed/fill, width, align, default sort, sortable, filter kind, hidden, decimals,
  renderer, badge colours per option), search field (match operator, query param, required), action (label, id,
  style, icon, API path, permission key, confirmation), grid (server paging, page size, load on open, selection,
  empty text, opened entry display, grid features), Master-Slave (layout, split, stack width, unsaved-changes
  policy, link field), entity (label, plural, endpoint, title field, server permissions, permission module and
  role grants, backend options and custom actions, parent and delete rule).
  Renaming a field updates every reference (form items, columns, search fields, sorters, visibility rules, copy
  exclusions, link field, title field). Deleting a field lists where it is used first.
* **Issues** (top-bar pill) — validation runs ~0.5 s after every edit against the whole app (see
  [§10 semantic checks](#semantic-checks)); click an issue to select the offending element.
* **Undo/redo** — every edit is one history step (150 deep); text inputs commit on Enter/blur so typing is one
  step, not one per key. The top bar shows *unsaved*; leaving with unsaved changes asks first.

### Preview
The display rendered by the **real framework templates** (the code the app runs):
* **Sample data** — an in-memory API that behaves like a generated one: filters, From/To ranges, sorting,
  start/limit paging with totals, create/update/delete with required/unique/option validation, parent/child links
  with the delete rule, custom actions and an audit trail (so *History* works). A side panel logs every call.
* **Live API** — the app's API through UI Forge's proxy after signing in (your real permissions apply).
* **Pretend user** — switch each permission off to see what a role gets: hidden buttons, read-only forms, or
  "cannot open". (Hints only — the API enforces the same permissions.)
* Desktop / tablet / phone widths; Entry previews can open a record id or *new*; **Reset** re-seeds the data.
* Developer hooks are not executed in the preview (they are app code).

### Code
Every file the design generates, exactly as Generate will write it, grouped by root and owner:
generated (lock icon, read-only), yours (pencil) and marked blocks inside your files. Developer files that do not
exist yet are **editable here**: the starting code you type (e.g. a validator) is syntax-checked as you type
(TypeScript/JSX/JS) and written once by Generate. Files that already exist are never touched.

### Schema
The raw JSON of the display and its entities with live validation (JSON syntax and schema), **Apply to design**
(undoable), **Export bundle** (display + entities in one file) and **Import** (opens a bundle as a new draft).

### Generate
1. **Save** (generation always uses saved documents).
2. **Plan** — counts per status, problems, and a list of changed files with **unified diffs**; *show unchanged and
   kept* to see everything; **Delete orphans** to remove files no schema produces any more.
3. **Generate the code**, two ways:
   - **Stage for review** (the default): writes this display's code to `<app>/ui-forge-out/<display-id>/`, laid out
     like the project (`app/…`, `api/…`), with a `README.md` that lists every file (generated, yours, shared or design),
     what it does, what to do with it, and the exact commands to copy it in (also into the mirror), register the menu,
     restart the API and test. **Nothing is written into the project.** Review and adjust the files there, then copy
     them in. Staging again moves the previous folder to `ui-forge-out/.previous/` so your edits are kept.
   - **Apply to project**: writes straight into the project (with a backup of anything overwritten, refusing if files
     changed since the plan), then re-plans so you can see it is clean.
4. **Register the menu** — dry run or real registration of the module manifests with the display registry
   (needs the app sign-in; uses your token, never stored).
5. **Verify** — type-check the app (`tsc --noEmit`), run the generated API tests, show the integration
   checklist, download everything as a zip.

### Keyboard
| Keys | Action |
|---|---|
| Ctrl+S | Save |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / redo |
| Ctrl+1 … Ctrl+5 | Design, Preview, Code, Schema, Generate |
| Delete / Backspace | Remove the selection from the layout (the entity field stays) |
| Ctrl+D | Duplicate (a duplicated field becomes a new entity field `name2`) |
| Alt+↑ / Alt+↓ | Move the selection (fields hop between sections at the edges) |
| Esc | Select the display |
| ? | Shortcut help |

---

## 4. Display types

### Entry (`type: "entry"`, registry type `entry-form`)
* Sections: `panel` (titled box, optionally collapsible/collapsed), `fieldset`, `tab` (consecutive tabs form one
  tab strip), `plain`. Form columns 1–4 (12 allowed in the schema), per-section override, per-field span.
* Widgets by data type: text → input/textarea; numbers → input (currency shows its code); date/datetime/time →
  native pickers; boolean → checkbox/switch; enum/lookup → select/radio/multiselect (multiple values).
* Actions (`entry.actions`, in order):
  | kind | does | default permission key |
  |---|---|---|
  | save | POST (new) or PUT; field errors from the API are shown on the fields | create / update |
  | delete | confirms, DELETE, closes | delete |
  | copy | a new record prefilled from this one; clears the id, the `copyExclude` fields and appends " (copy)" to the title field | create |
  | audit | history drawer from the app's audit trail (`/audit`), with the before/after of each change | — |
  | reset | puts back the last loaded values | — |
  | cancel | closes, asking first when there are unsaved changes | — |
  | custom | `POST {endpoint}/{id}/{path}` (or `hooks.onAction` when there is no path) | its `permission` key |
* Opened from the menu with `params: { id: "new" }`; from a grid with the record id.

### Summary (`type: "summary"`)
* Columns: header, fixed width or flex, alignment, default sort, sortable, filter (auto/text/number/date/list/off),
  hidden (still in the column chooser), decimals, renderer (`badge` or a registered renderer), badge colours.
* Search panel: fields with operators `eq`, `contains`, `gte`, `lte`, `between`, `in`. Query parameters:
  `{param}` for eq/contains/in (comma-separated for several values) and `{param}From` / `{param}To` for between,
  gte and lte. `param` defaults to the field name.
* **Server paging** (`remote: true`): the grid sends `start`, `limit`, `sort=[{"property","direction"}]` and the
  search parameters, and expects the envelope `{ success, data, total }`. Without it, the grid loads once and
  sorts/filters client-side. Generated APIs implement both.
* Toolbar actions `new`, `open`, `delete`, `refresh`, `custom`; row (right-click) actions `open`, `delete`,
  `custom`; multi-selection runs delete/custom on every selected row.
* `entryDisplay`: the Entry display New/Open opens.

### Master-Slave (`type: "master-slave"`)
* `master`: a Summary layout of the master entity.
* `detail.relation: "same"` — the form edits the selected master row. `"child"` — a child list filtered by
  `linkField = master id`, plus a form for the selected child; new children get the link value automatically and
  the link field is not shown.
* `unsavedChanges`: `confirm` (ask), `discard`, or `block` when the user selects another master row with unsaved
  form changes. `orientation` horizontal/vertical, `split` 20–80 %, `stackBelow` px (narrow screens stack).
* Child permissions use the keys `detail-create`, `detail-update`, `detail-delete`.

---

## 5. Permissions and security

**Server-side first.** Every generated route calls `need(ctx, permission)` from the app's existing security
model before doing anything; the UI only hides what the user may not do. Removing a button is never the control.

* **Entity permissions** (`permissions.view/create/update/delete`) must be permissions the app knows: an existing
  one (parsed from `BASE_MODULES` in `server/security.js`) or one declared by a `permissionModule`.
* **Permission module** (`permissionModule: { module, label, actions, actionLabels, grants }`) adds a module to
  the app's role editor (*Admin → Roles*). `grants` (role name → actions) are applied **once**, when the module first
  appears in a database (tracked in `db.appliedGrants`), so administrators remain in charge afterwards.
* **Display permissions**: `requiredPermissions` (all needed to see the menu entry and open the display; default:
  the view permission of every entity used) and `actionPermissions` (action key → permission; defaults from the
  entities). Both go into the registry manifest; the registry filters menus by them and the shell exposes them to
  the display as `meta.actions`. Custom action keys you add map here too.
* **Custom actions** of a generated entity are routes `POST {endpoint}/:id/<action>`, protected by the permission
  in `ACTIONS` (default the entity's update permission) and answering **501** until you implement the hook.
* **No secrets in generated code**: no URLs with credentials, tokens, passwords or machine paths are written into
  generated files (checked by a test). The API base comes from the app's `apiBase` at runtime.
* **The builder service** binds to 127.0.0.1 by default. Binding to another interface is refused unless
  `UI_FORGE_TOKEN` is set; with it, every API call needs the token (`X-UI-Forge-Token`; the builder asks for it
  once per tab). The application token from *Live API* sign-in stays in the browser tab memory and is forwarded
  per request (`X-App-Token`); UI Forge does not store it.
* The live proxy (`/app-api/*`) only forwards to the configured application API URL.

---

## 6. What gets generated

Per **entity** `GenerationAsset` in module `assets`:

| File | Owner | Purpose |
|---|---|---|
| `src/modules/assets/types/generation-asset.generated.ts` | generated | `GenerationAsset`, `GenerationAssetInput` (no id / read-only fields), `GenerationAssetChanges`, `GenerationAssetQuery`, `GenerationAssetPage`, option unions |
| `src/modules/assets/services/generation-asset.api.generated.ts` | generated | `generationAssetApi(api)`: typed `list` (with total), `get`, `create`, `update`, `remove`, `history` and one function per custom action, over the framework `ApiClient` |
| `src/modules/assets/generation-asset.schema.generated.ts` | generated | field definitions shared by configs |
| `server/generated/generation-asset.routes.generated.js` | generated | list/get/create/update/delete/custom routes |
| `server/generated/generation-asset.hooks.js` | **yours** | business rules for the API |

Per **display** `GenerationAssetSummary`:

| File | Owner | Purpose |
|---|---|---|
| `src/modules/assets/displays/generation-asset-summary/generation-asset-summary.config.generated.ts` | generated | the framework config (`SummaryConfig` / `EntryConfig` / `MasterSlaveConfig`) and `DISPLAY_ID` |
| `.../GenerationAssetSummary.tsx` | **yours** | `createSummaryDisplay(config, hooks)`; replace the template entirely if you need to |
| `.../generation-asset-summary.hooks.ts` | **yours** | `SummaryHooks` / `EntryHooks` / `MasterSlaveHooks` |

Shared:

| File | Owner | Purpose |
|---|---|---|
| `src/modules/generated-displays.ts` | generated | `defineDisplays({...})` of every UI Forge display (lazy-loaded chunks) |
| `src/displays.ts` | block | an import block and a registry block between `// <ui-forge:…>` markers, added once into your `mergeDisplays(...)` |
| `registration/<app>.ui-forge.<module>.manifest.json` | generated | displays (key, route, type, params, permissions) and menus (folders, entries) for the registry; version `1.0.<sum of revisions>` so it only increases |
| `server/generated/index.js` | generated | `permissionModules`, `actionLabels`, `entityTypes`, enum lookups, `register(api)` |
| `server/generated/forge-runtime.js` | generated | coercion, defaults, validation and filtering shared by the routes |
| `server/generated/selftest.generated.js` | generated | API tests for every generated entity |
| `src/modules/<module>/ui-forge/*.json` (mirror only) | generated | the schema documents copied to the mirror |
| `ui-forge.lock.json` | — | sha256 of every generated file as written, and the developer files UI Forge created |

Every generated file starts with a banner saying where it comes from and where to put code instead.

---

## 7. Writing business logic (hooks)

### Frontend (`*.hooks.ts`, typed by the framework)

```ts
import type { EntryHooks } from '@extreact/framework';
export const hooks: EntryHooks = {
  afterLoad: (record) => record,                       // reshape a loaded record
  beforeSave: async (values, ctx) => values,            // adjust or throw to stop the save
  afterSave: (saved, ctx) => {},                        // follow-up work
  validators: { notInPast: (v) => (v && v < today() ? 'Must not be in the past' : null) },  // FormItem.validator
  validate: (values) => (values.endAt <= values.startAt ? { endAt: 'Ends after it starts' } : {}),
  onAction: (action, ctx) => {},                        // custom actions without a path
  renderExtra: (ctx) => null,                           // extra content under the form
};
```
`SummaryHooks`: `onAction`, `transformRows`, `rowClass`. `MasterSlaveHooks`: `master` (SummaryHooks), `detail`
(EntryHooks), `detailList` (SummaryHooks).

### Backend (`server/generated/<entity>.hooks.js`)

```js
module.exports = {
  view: (record) => record,                                   // computed values in responses
  beforeSave: async (data, { isNew, existing, ctx, api }) => data,
  validate: (record, { ctx, api }) => ({}),                   // { field: message } → 400 with field errors
  afterSave: async (record, { isNew, ctx, api }) => {},
  canDelete: (record, { ctx, api }) => null,                  // a reason string → 409
  actions: {
    retire: async (record, body, { ctx }) => ({ status: 'Retired', gridConnected: false }),  // returned changes are validated and saved (read-only fields allowed)
  },
};
```
Routes are already protected by permissions and validate types, required, lengths, patterns, ranges, options,
lookups, uniqueness and parent existence before your `validate` runs.

---

## 8. Safe regeneration

`plan` compares every file the schemas produce with the disk and the lock file:

| Status | Meaning | On apply |
|---|---|---|
| create | the file does not exist | written |
| update | a generated file whose design changed; the disk still has exactly what UI Forge wrote | rewritten |
| unchanged | identical | — |
| conflict | a generated file was **edited by hand** (hash ≠ lock) or exists but was not written by UI Forge | skipped, unless forced (`--force app:path` / tick *overwrite*); the old file is backed up to `.ui-forge/backups/<time>/` |
| keep | your file exists | never touched |
| orphan | a generated file no schema produces any more | deleted only with prune, and only if unedited |
| retire | your component/hooks of a deleted display or entity (it imports generated files that are gone and would break the build) | with prune, **moved** to `.ui-forge/retired/<time>/` (never deleted) |

* **Plan hash**: apply recomputes the plan and refuses (HTTP 409 / exit 2) if anything changed since you reviewed
  it — another developer's edit, a hand edit, a different schema.
* **Determinism**: the same schemas always produce byte-identical files (sorted keys, stable ordering, `\n` line
  endings), so diffs only show real changes and CI can check "no pending changes" (`ui-forge plan` exit code).
* **Atomic writes**: each file is written to a temporary name and renamed.
* **Markers**: `src/displays.ts` is changed only between `// <ui-forge:import>` and `// <ui-forge:registry>`
  markers, inserted once (idempotent) into your `mergeDisplays(...)` call. If the file has no `mergeDisplays`,
  generation is blocked with an explanation instead of guessing.
* **Mirror**: with `--mirror`, everything under `src/modules/`, `registration/` and `src/displays.ts` is planned
  and locked separately in the mirror root, so `extjs-migrate --app-files <mirror>` keeps your displays on the next
  migration.

### Deleting displays and entities
Delete a display (Home → trash, or `DELETE /api/displays/{id}`), then Generate with **Delete orphans**: its
generated files are removed and your component/hooks are retired. An entity can be deleted when no display or child
entity uses it. Records already stored in the API's database are not deleted.

Migrated apps ignore `.ui-forge/` (backups and retired files) and `ui-forge-out/` (staged code) in `.gitignore`; add them
by hand for older apps.

---

## 9. Backend integration

UI Forge generates backend code for the **GridTrade Node API** (zero-dependency `server/server.js`). Three small,
hand-reviewed changes make the API load generated modules; they are already applied in
`gridtrade-contracts-extjs`:

* `server/security.js` — `generated = require('./generated')` when present; generated `permissionModules` and
  `actionLabels` are merged into `BASE_MODULES`/`ACTION_LABELS`; generated role grants are applied once per role.
* `server/server.js` — before the admin routes:
  `if (security.generated) security.generated.register({ route, need, ok, bad, notFound, HttpError, readBody, listResult, sortRows, store, D, isDate, nameOf, lookups })`
  — generated routes use the same router, permission check, envelope, validation errors, store (with automatic
  audit trail) and lookups as the hand-written ones.
* `server/db.js` — `reset()` re-applies `security.ensure(db)` so grants survive a data reset.

UI Forge recognises such an API by `security.generated` in `server/server.js` (`backend: gridtrade-node`). Without
`--api`, or with `backend.generate: false` on an entity, only the frontend is generated and the display uses the API
at `endpoint` as it is (`ui-forge` checks that hand-written routes and collections do not collide with generated ones).

**API contract of a generated entity** (`/api/generation-assets`):

| Request | Permission | Notes |
|---|---|---|
| `GET /` | view | `query` (text search), `<field>=v[,v2]`, `<field>From/To`, `sort=[{"property","direction"}]`, `start`, `limit` → `{ success, data, total }` |
| `GET /:id` | view | 404 when missing |
| `POST /` | create | unknown properties dropped; defaults applied; 400 with `errors: { field: message }` |
| `PUT /:id` | update | partial update; read-only fields ignored |
| `DELETE /:id` | delete | 409 when children exist (`restrict`) or `canDelete` refuses; `cascade` deletes children |
| `POST /:id/<action>` | per action | 501 until `actions.<action>` exists in the hooks file |

Every write records `createdBy/At`, `updatedBy/At` and an audit entry (entity type = `backend.auditEntityType` or the
label). **Restart the API after generating** — it loads `server/generated` at start-up.

---

## 10. Schema reference

The JSON Schemas are served at `GET /api/schema` and printed by `ui-forge schema`. Documents are strict (an unknown
property is an error, which catches typos).

### Entity (`*.entity.json`)
| Property | | |
|---|---|---|
| `schemaVersion` | `"1.0"` | migrated forward automatically when a newer UI Forge reads an older document |
| `kind` | `"entity"` | |
| `name` | PascalCase | type and file names; cannot change once saved |
| `label`, `plural` | text | messages, menu titles, audit type |
| `module` | slug | `src/modules/<module>` |
| `endpoint` | `/path` | relative to the app's `apiBase`; no `{placeholders}` when generated |
| `idField` | default `id` | added automatically |
| `titleField` | field | names a record (history, copy, delete messages) |
| `fields[]` | see below | at least one |
| `permissions` | `{view, create, update, delete}` | permission names |
| `permissionModule` | `{module, label, actions, actionLabels, grants}` | optional, see §5 |
| `parent` | `{entity, field, onParentDelete: restrict|cascade}` | child entities |
| `backend` | `{generate, collection, auditEntityType, customActions[]}` | |
| `description`, `revision` | | revision is bumped by Save |

Field: `name` (camelCase), `label`, `dataType` (`string text integer decimal currency boolean date datetime time
enum lookup`), `multiple` (enum/lookup), `required`, `unique`, `minLength`/`maxLength`, `min`/`max`, `decimals`,
`currency` (ISO code), `pattern` + `patternMessage`, `options` (enum), `lookup` (`{endpoint, valueField, labelField}`),
`defaultValue`, `upperCase`, `readOnly` (never changed through the API except by custom actions), `example` (a valid
value used by the generated tests and sample data), `description`.

### Display (`*.display.json`)
`schemaVersion`, `kind: "display"`, `id` (registry id, e.g. `assets.generation-assets`), `name` (implementation key,
PascalCase), `title`, `description`, `type` (`entry | summary | master-slave`), `module`, `route` (hash route),
`icon`, `openMode` (`tab | window | page`), `entity` (entry/summary), `menu` (`{id, title, parent, icon, sortOrder,
action, params, requiredPermissions, enabled}`), `folders[]` (`{id, title, parent, icon, sortOrder}`), `permissions`
(`{required[], actions{}}`), `entry` / `summary` / `masterSlave` layouts (see §4), `generator` (`{frontend, backend,
tests}`), `revision`.

`entry`: `columns`, `sections[]` (`{id, title, kind, columns, collapsible, collapsed, description, items[]}`),
`actions[]`, `copyExclude[]`, `summaryDisplay`. Item: `field`, `span`, `widget`, `label`, `placeholder`, `help`,
`readOnly`, `readOnlyOnEdit`, `hidden`, `visibleWhen {field, equals[]}`, `defaultValue`, `validator`.

`summary`: `columns[]`, `searchFields[]` (`{field, label, operator, param, required, defaultValue, placeholder}`),
`remote`, `pageSize`, `sorters[]`, `toolbarActions[]`, `rowActions[]`, `emptyText`, `selection`, `autoLoad`,
`entryDisplay`, `features` (DataGrid switches: `rowNumbers`, `grouping`, `summary`, `export`, `columnChooser`, …).

`masterSlave`: `master {entity, summary}`, `detail {entity, relation, linkField, masterKey, entry, summary}`,
`orientation`, `split`, `unsavedChanges`, `stackBelow`.

Action: `id` (slug), `kind`, `label`, `permission` (action key), `confirm`, `path` (custom), `style`, `icon`.

### Semantic checks
Beyond the JSON shape, every preview, save, plan and `validate` checks against the app:
* referenced entities, fields, link fields, title fields and lookups exist; widget fits the data type; a required
  field without a default missing from a form (error: every save would fail); enum options present;
* display id, implementation key, route and menu id are unique across UI Forge **and the existing app**;
  collections and endpoints do not collide with hand-written API routes;
* permissions exist (in the app or a declared module); a reused module only adds actions (warning);
* menu parents exist, no cycles, an Entry opened from the menu has `params.id`;
* actions fit their bar; custom actions of a generated entity are in `backend.customActions`;
* search operators fit the field type; no two search fields share a query parameter; a custom `param` on a
  generated API (warning: ignored there); server paging without page size (warning).

---

## 11. CLI reference

```
ui-forge [--app DIR] [--api DIR] [--mirror DIR] [-v] <command>

serve     [--host 127.0.0.1] [--port 8140] [--open]   the builder
stage     <display-id> [--out DIR]                     one display's code + README in <app>/ui-forge-out/<id>/ (nothing goes into the project)
validate  [display-id ...]                             schema + semantic checks
plan      [--diff] [--json] [--prune] [--check]        what generation would change (--check: exit 4 if not up to date)
apply     [--yes] [--force root:path ...] [--prune]    write (asks unless --yes)
check     [--user admin]                               integration checklist
register  --user admin [--password-env NAME] [--dry-run]   send manifests to the display registry
test      [--build] [--api]                            tsc --noEmit in the app; generated API tests
list | schema | export <display-id> | import <file.json>
```
Exit codes: **0** ok, **1** validation or test failure, **2** usage/configuration error or stale plan, **3**
conflicts left unapplied, **4** `plan --check` found pending changes. `--app/--api/--mirror` may come from
environment variables or `ui-forge.config.json`.

CI example: `ui-forge validate && ui-forge plan --check` fails the build when a design is invalid or someone
changed a schema without regenerating (or edited a generated file).

---

## 12. Service API

All under `http://127.0.0.1:8140`; OpenAPI at `/api/docs`.

| Method & path | Purpose |
|---|---|
| `GET /api/health` | liveness (no token needed) |
| `GET /api/project[?refresh=true]` | roots, app id, backend kind + inventory (menus, displays, permissions, lookups, routes) |
| `GET /api/schema` | JSON Schemas |
| `GET /api/workspace` | saved entities, displays, file paths, issues |
| `POST /api/preview` | `{entities, displays, replace, focus}` → issues, framework configs, registry metas, generated files (nothing written) |
| `POST /api/save` | write documents (revision bump; `replace` maps a renamed display) |
| `DELETE /api/displays/{id}` · `DELETE /api/entities/{name}` | remove documents |
| `POST /api/stage` | `{displayId, overrides}` → staging folder, files (owner, what to do), README text |
| `POST /api/plan` · `POST /api/apply` | `{prune, overrides}` · `{hash, force[], prune, overrides}` |
| `GET /api/package` | zip of every generated file plus the schema documents |
| `POST /api/session` | sign in to the application API → token (returned to the browser only) |
| `GET/POST/PUT/DELETE /app-api/{path}` | proxy to the application API (live preview) |
| `POST /api/register` · `GET /api/checklist` · `POST /api/test/{build|api}` | integration |
| `GET /api/infer?endpoint=` · `POST /api/parse` | read fields from an API · validate one document |

---

## 13. Configuration

`ui-forge.config.json` in the app root (optional; arguments and environment variables win):

```json
{
  "apiRoot": "../gridtrade-contracts-extjs",
  "mirrorRoot": null,
  "appId": "gridtrade",
  "apiBase": "/api",
  "appApiUrl": "http://127.0.0.1:5080/api",
  "registryUrl": "http://127.0.0.1:8130"
}
```

| Environment variable | Default | |
|---|---|---|
| `UI_FORGE_APP`, `UI_FORGE_API`, `UI_FORGE_MIRROR` | — | roots |
| `UI_FORGE_APP_API_URL` | `http://127.0.0.1:5080/api` | live preview, sign-in, infer, checklist |
| `UI_FORGE_REGISTRY_URL` | `http://127.0.0.1:8130` | registration and menu checks |
| `UI_FORGE_HOST`, `UI_FORGE_PORT` | `127.0.0.1`, `8140` | service binding |
| `UI_FORGE_TOKEN` | — | require this token on every API call (mandatory for non-local binding) |

`appId` and `apiBase` default to the values in the app's `src/app.config.ts`.

---

## 14. The example: GridTrade assets

`examples/gridtrade-assets.json` holds three representative displays and two entities:

* **Generation Assets** (Summary) — server paging (25/page), search by type/region/status, capacity and
  commissioning ranges, badge colours, toolbar New/Open/Retire/Delete/Refresh, row menu.
* **New Generation Asset** (Entry) — two tabs (General, Technical) and a collapsible Notes panel; radio, lookup,
  multiselect, currency, switch, date; a conditional-visibility rule on dispatch tags; code locked
  after create; Save, Copy (code excluded), History, Retire (custom action), Reset, Delete, Close.
* **Asset Outages** (Master-Slave, child) — assets on the left, their outages and the outage form on the right;
  `restrict` delete rule; unsaved-changes guard.

Developer code included in GridTrade as an example of hooks: the API's `retire` action and a `canDelete` rule
(operational assets cannot be deleted), an API `validate` (outage ends after it starts) and the same rule in the
Master-Slave's frontend hooks.

---

## 15. Testing and what was verified

| Suite | Command | Result at hand-over |
|---|---|---|
| UI Forge (schema, semantics, determinism, regeneration safety, conflicts/backups, stale plans, prune/retire, path sandbox, server-side permissions, no secrets, service, token guard, staging never touches the project) | `pytest tests/unit/test_ui_forge.py` | 23 passed |
| Platform unit tests | `pytest tests/unit` | all passed |
| Builder logic (drop rules, custom-action routes, duplicate/move/remove, rename, plurals) | `cd ui-forge-web && npm test` | 9 passed |
| Framework templates | `cd agents/extjs-migration-agent/framework && npm test` | 21 passed |
| GridTrade API self-test (existing) | `npm run test:api` | 73 passed |
| Generated API tests | `node server/generated/selftest.generated.js` | 23 passed |
| App type check / build | `npx tsc --noEmit`, `npx vite build` in `gridtrade-react` | clean |
| Re-migration keeps the displays | `extjs-migrate migrate … --shell framework --app-files <mirror>` into a new folder, then `tsc` and `ui-forge plan` there | type check clean; plan: 34 unchanged, 14 kept (nothing looks hand-edited) |
| Browser, the app | Assets menu, entry validation/tabs/save, history, retire, copy, remote paging/search, master-slave child create with hook validation, unsaved guard; all 15 existing displays; three roles' menus | passed, no console errors |
| Browser, the builder | home, drag/drop, inspector, undo/redo, click-to-add, resize, issues, preview (entry/summary/master-slave, phone), code view, discard, wizard (summary+entry pair), save, plan/diff/generate, type-check and API tests from the UI, live sign-in, registry dry run, delete + prune/retire | 18/18 steps passed (incl. Stage for review), no console errors |

The browser test of the builder is `ui-forge-web/e2e/builder.e2e.cjs` (it needs the full local stack and Playwright,
and it writes to the configured app, then removes what it created), so it is not part of CI; the Python and vitest
suites are.

---

## 16. Integration checklist

The **Verify → Checklist** button (and `ui-forge check`) reports each item as done, to do or unknown, with the fix:

1. Schemas are valid (no errors in any display or entity).
2. Generated files are up to date (no pending creates/updates, no conflicts, no plan problems).
3. `src/displays.ts` includes the generated displays (markers present).
4. Backend modules load (`node -e "require('./server/generated')"` succeeds).
5. The running API serves the generated modules (restart it after generating; sign in to check).
6. Menus and displays are registered (the registry has the module at the current version).

Before merging, also: review the plan diff in the pull request; commit the schema documents, generated files,
your hooks and `ui-forge.lock.json` together; give roles the new permissions in *Admin → Roles* (grants only apply
once); re-run `scripts\migrate-gridtrade.ps1` if you want to prove the mirror keeps everything.

---

## 17. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| *"…is not a framework-shell React app"* | `--app` must point at a migrated app with `src/displays.ts` that depends on `@extreact/framework` (`extjs-migrate … --shell framework`). |
| *"…has no server/server.js with the UI Forge module seam"* | the API root lacks the seam of §9; apply it or leave `--api` out (frontend only). |
| Generation blocked: *"src/displays.ts does not call mergeDisplays"* | add `generatedDisplays` to your registry by hand once, or use `mergeDisplays(...)`. |
| A file shows **conflict** | it was edited by hand. Move the change into the hooks/component file, or force (a backup is kept). |
| Apply says the plan is **stale** (409 / exit 2) | files or schemas changed after the plan; review the new plan. |
| New menu entry does not appear | Register (Generate step 4 or `ui-forge register`), and check the user has `requiredPermissions`. |
| 404 from new API routes | restart the API: generated modules load at start-up. |
| 501 from a custom action | implement `actions.<name>` in `server/generated/<entity>.hooks.js`. |
| Live preview / Read fields says 401 | sign in under *Preview → Live API*. |
| Type check fails after deleting a display | Generate with *Delete orphans* so the display's own files are retired. |
| Port 8140 in use | `scripts\stop-local.ps1`, or `ui-forge serve --port 8150`. |
| Builder page is blank | the SPA is not built: `scripts\setup-local.ps1 -Builder` (or `npm ci && npm run build` in `ui-forge-web`). |

---

## 18. Limitations and roadmap

Honest boundaries of version 1.0:

* **Backend generation targets the GridTrade Node API** (its router, `need()`, store and audit). Other backends
  (e.g. FastAPI, Spring) get frontend code only and use an existing API (`backend.generate: false`); a backend
  generator interface exists in `gen_backend.py` but has one implementation.
* **One designer at a time per app**: two people saving the same document overwrite each other (the last save
  wins; the plan hash protects generation, not editing). Use Git branches and review the JSON diffs.
* **Hooks are not run in the preview**; the preview uses the mock API or the live API without your new routes until
  the API is restarted.
* **No visual editing of existing hand-written or migrated displays** — UI Forge creates new metadata displays; it
  lists the others for conflict checks.
* Grid features beyond the switches shown (grouping fields, editing) are set in `features` in the Schema view.
* Data migrations are out of scope: renaming or removing a field changes the API contract, not stored records.
* Schema `1.0` is the first version; `migrate()` is the place where future versions will upgrade older documents.

Next steps worth doing: multi-user locking in the service, a backend generator for the platform's FastAPI services,
reusable field sets ("address", "audit columns"), visual editing of `features`, and recording the builder test in
CI with a containerised stack.

---

## 19. Working on UI Forge itself

```
src/ui_forge/          Python package (service, CLI, generators)
  schema.py            pydantic models, JSON Schemas, migrate()
  workspace.py         reading/saving documents, draft overlay
  project.py           roots, configuration, inventory of the existing app
  semantic.py          cross-document checks
  resolve.py           schema → framework configs and registry permissions
  gen_frontend.py      TypeScript files and src/displays.ts wiring
  gen_backend.py       GridTrade Node routes, runtime, index, self-test
  gen_registration.py  registry manifests
  plan.py              plan / apply / lock / backups / retire
  checks.py            checklist, build and API tests, registration, sign-in
  service.py, cli.py   FastAPI service and CLI
  static/              the built builder (output of ui-forge-web)
  examples/            gridtrade-assets.json
ui-forge-web/          the builder (React 18, Vite, CodeMirror 6; the preview imports the framework source)
  src/catalog.ts       controls and the defaults they create
  src/ops.ts           drag-and-drop and keyboard operations (pure functions, unit-tested)
  src/layout.ts        panel helpers, rename, usage
  src/store.tsx        document state, history, preview, save
  src/canvas/ inspector/ rail/ preview/ views/ ui/
```

```bash
cd ui-forge-web
npm ci
npm run dev        # http://localhost:5175, proxies /api to a running `ui-forge serve` (UI_FORGE_URL)
npm test
npm run build      # type-checks, then writes ../src/ui_forge/static
```

Adding a control: add it to `CONTROLS` in `catalog.ts` (and, for a new data type or widget, to `schema.py`,
`resolve.py` and the framework's `fields.ts`). Adding a schema property: model in `schema.py`, mapping in
`resolve.py`, checks in `semantic.py`, inspector row, and a test.
