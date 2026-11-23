# @extreact/framework

The reusable part of every migrated application. Apps configure it; they do not edit it.

| Folder | What |
|---|---|
| `shell/` | `FrameworkApp`: sign-in gate, menu bar, tab workspace, modal displays, deep links, toasts, `useShell` / `useFrame` |
| `auth/` | session store (sessionStorage), `AuthProvider`, `passwordAuth` adapter, `LoginPage` |
| `navigation/` | `MenuBar` rendered from the registry's menu tree |
| `display/` | approved registry (`defineDisplays`, `mergeDisplays`, `resolveDisplay`) and `DisplayHost` |
| `routing/` | hash routes (`#/<route>?param=value&action=new`) |
| `templates/` | `SummaryDisplay` / `createSummaryDisplay`, `EntryFormDisplay` / `createEntryDisplay`, field rules, lookups |
| `compat/` | `createExtScreen` for screens still on `@extreact/runtime` |
| `grid/` | `DataGrid` (React + AG Grid Community 36) |
| `api/` | fetch client: token, correlation id, timeout, `{ success, data }` envelopes, field errors |

```bash
npm install
npm test          # vitest + jsdom: units and the shell end to end
npm run typecheck
npm run build     # dist/ (ES modules + .d.ts + styles.css) when used as a package
```

The migration agent copies `src/` into each app as `src/framework/` and maps `@extreact/framework` to it, so apps
build offline and switch to a published package later without code changes.
