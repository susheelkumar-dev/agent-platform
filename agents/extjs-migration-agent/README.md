# Ext JS to React Migration Agent

Migrates an Ext JS 6/7 **classic** application to **React 18 + TypeScript + Vite**. You point it at the app folder;
it analyses every class, ports the code, writes a runnable project, builds it, and writes a migration report.
It runs as a command line tool (`extjs-migrate`) and as an agent service on the AI Agent Platform.

Reference application: **GridTrade Contracts** (`gridtrade-contracts-extjs`). Its 101 classes cover contracts, trades, time
series, data ingestion, reference data, user management and the audit trail. It migrates with 100% framework coverage
and no source changes. The migrated app runs against the same Node API, and the same Playwright browser flows give the
same results as the Ext JS build (see *Verification* below).

## How it works

```
discover ─▶ analyze ─▶ rules + generate ─▶ LLM fallback (optional) ─▶ verify ─▶ report
```

1. **Discover** (`extjs_migrator/discover.py`) reads `app.json` (comments and trailing commas allowed) and collects:
   - the classpath and overrides
   - `app.js` and `index.html`
   - the sass `var` / `etc` / `src` folders
   - `resources/`
2. **Analyze** (`analyzer.py`, esprima, pure Python) does three things:
   - Parses every `Ext.define` and `Ext.application`, and resolves the class hierarchy and nearest framework base.
   - Records framework usage: classes, xtypes/aliases, `Ext.*` APIs, configs per xtype, events, bindings, routes and templates.
   - Computes the load order (extend, mixins, override, then requires).
3. **Rules** (`rules.py`) prepare each file to run as a strict-mode ES module:
   - Implicit globals are kept global through `globalThis`.
   - Top-level `this` becomes `globalThis`, and legacy octals are rewritten.
   - `with`, `arguments.callee`, duplicate parameters and `delete x` are reported.
   - Every `Ext.*` API, class and alias is checked against the runtime **manifest**. Gaps are reported, and the member that uses one is queued for the LLM pass.
4. **Generate** (`generate.py`) writes the project:
   - one module per source file, importing `Ext` from the `@extreact/runtime` package;
   - `src/main.ts` importing the runtime, styles and modules in load order;
   - `package.json` depending on the prebuilt `@extreact/*` packages in `packages/` (no library code is copied);
   - `src/app-globals.d.ts` declaring the app's namespaces (e.g. `GT`) so the converted code type-checks;
   - `index.html` without the Sencha microloader;
   - Vite config with an `/api` proxy to the original backend;
   - `public/resources`;
   - the theme (`styles.py`): `dynamic()` is stripped, and Ext theme variables become CSS variables the runtime theme reads.
5. **LLM fallback** (`llm.py`, optional) only handles members the rules flagged. It uses a local **Ollama** model (offline)
   or the platform's LLM gateway. A reply is applied only if all of these hold:
   - it parses;
   - it keeps the member's shape;
   - it no longer uses the flagged construct.

   Replies are cached by content hash, so re-runs are repeatable.
6. **Verify** (`verify.py`) runs `npm install`, `tsc --noEmit`, `vite build` and, optionally, a headless-browser smoke
   test that fails on console errors. Build errors are mapped back to the module.
7. **Report** (`report.py`): `MIGRATION_REPORT.md` + `migration-report.json` contain:
   - coverage, findings and the per-class table;
   - LLM attempts and verification output;
   - next steps.

### The runtime: `@extreact/runtime`

`runtime/` is a React + TypeScript implementation of the Ext JS API the migrated code calls. This is what lets
controllers, view models, stores and view configs port almost verbatim, with no Ext JS licence in the output.

| Area | Implemented |
|---|---|
| Core | `Ext.define` (extend, mixins, config, statics, privates, singleton, alias/xtype, override, `callParent`/`callSuper`), `Ext.create`/`widget`/`Factory`, observable (`on`/`un`/`fire`, buffer/delay/single, `mon`, `relayEvents`), `Ext.*` utilities, `Ext.Date`, `Ext.util.Format`, `Ext.XTemplate`, collections, tasks, `Ext.Promise` |
| Data | `Ext.Ajax`, models (fields, validators, identifiers, save/erase/load), proxies (ajax, rest, memory), JSON/array readers and writers, `Store` (local and remote sort, filter, group, paging, sync), `ChainedStore`, `ArrayStore`, `StoreManager` |
| App | `ViewController` (listen domains, routes, control, references), `Ext.app.Controller`, `Application` / `Ext.application`, view models (formulas, two-way binding, publishes), router / History, state providers |
| UI | Component / Container with layouts (fit, card, hbox, vbox, anchor, form, column, border with splitters and collapse, absolute, center), Panel (header, tools, docked items, collapse, close), Toolbar, Paging, Button, Segmented, Menu, Tab panel, Window, `Ext.Msg`, `Ext.toast`, quick tips / tooltips |
| Forms | Text, TextArea, Number, Display, Hidden, Checkbox, Radio, File, ComboBox (local/remote, anyMatch, forceSelection, typeAhead, multiSelect), Tag, Date with picker, FieldContainer, CheckboxGroup, RadioGroup, FieldSet, `Ext.form.Basic` / `Panel` |
| Grid | Columns (number, date, boolean, template, check, action, rownumberer, grouped headers, locked), view API (`getNode`, `getCell`, `getRecord`, `getHeaderByCell`, `refresh`, events), selection models (row, checkbox, cell), cell and row editing, row expander, grid filters, grouping, grouping summary, summary, header menu, resize/move, state |
| Charts | Cartesian chart in SVG: numeric/category axes, bar (stacked or grouped), line/area (smooth, markers, fill), DOM legend, tooltips, item highlight, crosszoom |

The runtime renders the **same DOM class names as Ext JS**: `x-grid-item`, `x-grid-cell`, `x-btn-inner`, `x-tab-active`,
`x-form-trigger` and so on. The app's own SCSS and DOM-reading code (plugins such as GridTrade's RangeFill) keep working.
Every component re-renders independently (`useSyncExternalStore`), and updates are batched to a microtask. DOM reads
(`getEl`, `view.getNode`) flush first, so imperative Ext code sees an up-to-date DOM. `runtime/manifest.json` lists
every implemented class, alias, static and method. It is regenerated by the runtime's test suite, and the agent's
coverage check reads it.

## Command line

```bash
pip install -e agents/extjs-migration-agent        # esprima; Node 18+ is needed for --verify
extjs-migrate analyze /path/to/extjs-app           # inventory + coverage, writes nothing
extjs-migrate migrate /path/to/extjs-app -o ./app-react --verify
extjs-migrate migrate /path/to/extjs-app -o ./app-react --llm ollama --verify \
    --smoke-url http://localhost:5080/ --smoke-selector gt-main
```

Run the result against the original backend:

```bash
cd app-react
API_TARGET=http://localhost:5080 npm run dev       # Vite proxies /api to the Ext JS app's backend
npm run build                                      # dist/ can be served by the same backend
```

For GridTrade:

```bash
GT_WEB_ROOT=/path/to/app-react/dist npm start
```

The API then serves the React build in place of the Ext JS one. A framework-shell build also needs its menus from
the display registry: the API forwards `/registry/*` to `GT_REGISTRY_URL` (default `http://127.0.0.1:8130`), so one
port serves the whole app.

## Framework shell (`--shell framework`)

The same ported modules can be hosted by **`@extreact/framework`** instead of the Ext viewport. The two libraries are
written once, versioned, and shipped with this agent as prebuilt packages in `packages/`; an application depends on
them (`"@extreact/runtime": "file:…/extreact-runtime-1.1.0.tgz"`) and never contains a copy:

- **`@extreact/runtime`**: the Ext JS-style class system (`Ext.define`, mixins, config), data (models, stores,
  proxies, Ajax), controllers, view models, routing and components (panels, grids, forms, windows, charts) for React.
  Converted code keeps the Ext JS structure developers know, as typed ES modules.
- **`@extreact/framework`**: sign-in (tokens refreshed before they expire); a menu bar built only from the **display
  registry** (`docs/display-registry.md`), filtered by permission; a tab workspace, deep links
  (`#/reference/counterparties?id=12`), modal displays, notifications; an approved display registry (the database names a
  display's implementation key, `src/displays.ts` lists the keys this build contains); templates **Summary**,
  **Entry Form** and **Master-Slave** on the shared DataGrid; `classicDisplays` / `classicBridge` to host Ext-style
  views by xtype (display type `custom`).

Rebuild the packages after changing `runtime/` or `framework/`: `scripts/build-packages.ps1` (or `npm run pack:local`
in each folder), and bump the version so applications pick the new build up.

How a display is registered, which file does what, and how a request flows: [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md).

```bash
extjs-migrate migrate /path/to/extjs-app -o ./app-react --shell framework --app-files ./app-react-files --verify
```

Generated on every run: `src/main.tsx`, `src/ext-modules.ts`, `src/app-globals.d.ts`, the ported modules.
Application-owned, written once when missing and never overwritten: `src/app.config.ts`, `src/displays.ts`,
`src/app-bridge.ts`, `src/modules/**`, `registration/**`. `--app-files` copies a developer's versions of those
(only needed for a first conversion that should start with existing displays; afterwards the output folder is the app, and re-running the migration into it keeps those files), plus `ui-forge.lock.json` / `ui-forge.config.json` so
UI Forge displays survive a fresh migration (see `src/ui_forge/README.md`). `--shell compat` (the default) is unchanged.

Run it with the backend and the registry:

```bash
display-registry                                              # port 8130 (see docs/display-registry.md)
agentctl display register app-react/registration/*.manifest.json --registry http://localhost:8130 \
    --app-api http://localhost:5080/api --user admin
cd app-react && API_TARGET=http://localhost:5080 REGISTRY_TARGET=http://localhost:8130 npm run dev
```

The first `npm install` of a framework app needs the internet once for AG Grid; later runs work offline.

## Agent service

```bash
cd agents/extjs-migration-agent && cp .env.example .env && python main.py    # port 8120
```

| Capability | Input | Result |
|---|---|---|
| `extjs.app.analyze` | `path` (or a path in `message`) | classes by category, framework coverage, findings |
| `extjs.app.migrate` | `path`, `output`, `shell` (`compat`/`framework`), `app_files`, `llm` (`none`/`ollama`/`platform`), `verify` | output folder, report files, coverage, build result, next steps |

The agent only reads under `EXTJS_MIGRATE_ROOTS` and writes under `EXTJS_MIGRATE_OUTPUT` (both read from the
environment or from the agent's `.env`; separate several roots with `;` on Windows). It is not idempotent (it writes
files), and `llm: platform` uses the platform LLM gateway with the caller's context.

From the chat UI, where fields cannot be passed, the message decides: "framework" selects the framework shell,
"build" or "verify" turns on the build check, and the app's own files are taken from `<output>-app` next to the output
folder (`gridtrade-react` → `gridtrade-react-app`), or from an older `react-app/` folder next to `web/`, as `app_files`. The default output folder is named after the repository (`<repo>-react`). From the API:

```bash
curl -s http://127.0.0.1:8000/api/v1/chat -H "Authorization: Bearer demo-admin" -H "content-type: application/json" -d '{
  "message": "Migrate the Ext JS app", "capabilities": ["extjs.app.migrate"],
  "variables": {"path": "/work/gridtrade-contracts-extjs/web", "output": "gridtrade-react", "shell": "framework",
                "app_files": "/work/my-app-files", "verify": true}}'
```

## Verification on GridTrade

- `extjs-migrate analyze`: 101 classes; 73 framework classes, 51 aliases and 81 `Ext.*` APIs used, all supported.
- `vite build` passes. The app boots against the GridTrade Node API with no console errors on any of its 14 screens.
- The Playwright flows written for the Ext JS app run against both builds with fresh data, and their outputs are compared. They cover:
  - contract create / validate / approve, trades, CSV ingestion and interval edit;
  - filters and grouping, lookup edit pop-ups and user management;
  - range fill.
- Tests:
  - `runtime/`: `npm test` (vitest + jsdom). It covers the class system, the data layer with GridTrade's own models and stores, UI, forms, grid and charts, and writes the manifest.
  - `tests/`: `pytest` covers analysis, load order, rules, styles, generation and the LLM acceptance checks.

## Limits

- **Classic toolkit only.** Modern-toolkit components are reported as missing coverage.
- **Generated code keeps the Ext.define structure** (on purpose: Ext JS developers keep working the way they know).
  With `--verify`, every module that type-checks is checked by `tsc`; only modules with remaining type errors keep
  `// @ts-nocheck`, and the report lists them (GridTrade: 97 of 101 checked). Without `--verify` no type check runs,
  so every module starts with `// @ts-nocheck`.
- **Offline.** The `@extreact` packages are local files and the LLM pass uses a local Ollama model. Other npm
  packages (React, AG Grid, Vite…) come from the npm cache when present (`npm install --prefer-offline`): install once
  with network, or point npm at an internal registry mirror, to work fully offline.
- **Not implemented yet:**
  - buffered rendering for very large grids (rows render in full);
  - tree panels;
  - drag-and-drop between components;
  - polar and 3D charts;
  - Sencha theme mixins (reported, restyle with CSS).
