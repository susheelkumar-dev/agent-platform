"""React / TypeScript files for the framework-shell app, following the app's module convention
(src/modules/<module>/types, services, displays/<display>/; see modules/reference for the hand-written pattern).

Per entity (generated):   types/<entity>.generated.ts, services/<entity>.api.generated.ts, <entity>.schema.generated.ts
Per display (generated):  displays/<display>/<display>.config.generated.ts
Per display (developer):  displays/<display>/<DisplayName>.tsx, displays/<display>/<display>.hooks.ts
App (generated):          src/modules/generated-displays.ts (the approved registry of every UI Forge display)
App (block):              src/displays.ts gets the import and the registry between ui-forge markers
"""

from __future__ import annotations

import json
import re
from typing import Any

from .files import GeneratedFile, ts_banner
from .naming import camel, constant, display_folder, entity_file, pascal
from .resolve import column_def, config_type, display_config, factory, field_def
from .schema import DisplaySchema, EntityDef, EntityField
from .workspace import Workspace, display_path, entity_path

IMPORT_BEGIN, IMPORT_END = "// <ui-forge:import>", "// </ui-forge:import>"
REG_BEGIN, REG_END = "// <ui-forge:registry>", "// </ui-forge:registry>"


def ts(value: Any, indent: int = 0) -> str:
    """A TypeScript literal (JSON is valid TypeScript; keys that are identifiers are left unquoted)."""
    text = json.dumps(value, indent=2, ensure_ascii=False)
    text = re.sub(r'^(\s*)"([A-Za-z_$][A-Za-z0-9_$]*)":', r"\1\2:", text, flags=re.M)
    if indent:
        text = text.replace("\n", "\n" + " " * indent)
    return text


def _lit(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)


def ts_type(ws: Workspace, f: EntityField) -> str:
    t = f.dataType
    if t in ("string", "text", "date", "datetime", "time"):
        base = "string"
    elif t in ("integer", "decimal", "currency"):
        base = "number"
    elif t == "boolean":
        base = "boolean"
    elif t == "enum":
        base = " | ".join(_lit(o) for o in f.options or []) or "string"
    else:  # lookup
        target = next((e for e in ws.entities.values() if f.lookup and e.endpoint == f.lookup.endpoint), None)
        base = "number" if target else "string | number"
    if f.multiple:
        return f"({base})[]" if "|" in base else f"{base}[]"
    return base


def _entity_files(ws: Workspace, e: EntityDef) -> list[GeneratedFile]:
    src = entity_path(e)
    ef = entity_file(e.name)
    base = f"src/modules/{e.module}"
    T = pascal(e.name)
    out: list[GeneratedFile] = []

    # ---- types
    lines = [ts_banner(src), f"/** {e.label}{': ' + e.description if e.description else ''} */", f"export interface {T} {{",
             f"  {e.idField}: number;"]
    enums = []
    for f in e.fields:
        typ = ts_type(ws, f)
        if f.dataType == "enum" and not f.multiple:
            alias = T + pascal(f.name)
            enums.append(f"export type {alias} = {typ};")
            typ = alias
        doc = f"  /** {f.label}{' (' + f.description + ')' if f.description else ''}{' · read only' if f.readOnly else ''} */"
        lines.append(doc)
        lines.append(f"  {f.name}: {typ};" if f.required else f"  {f.name}?: {typ} | null;")
    lines += ["}", ""]
    ro = [e.idField] + [f.name for f in e.fields if f.readOnly]
    lines += enums + ([""] if enums else [])
    lines += [
        "/** What create sends (the id and read-only fields come from the server). */",
        f"export type {T}Input = Omit<{T}, {' | '.join(_lit(x) for x in ro)}>;",
        "/** What update sends: only the fields that changed. */",
        f"export type {T}Changes = Partial<{T}Input>;",
        "",
        f"/** Query parameters of GET {e.endpoint}: a field's value filters by it (text fields: contains); <field>From / <field>To bound numbers and dates. */",
        f"export interface {T}Query {{",
        "  /** words searched in every text field */",
        "  query?: string;",
    ]
    for f in e.fields:
        lines.append(f"  {f.name}?: string | number | boolean;")
        if f.dataType in ("integer", "decimal", "currency", "date", "datetime", "time"):
            lines.append(f"  {f.name}From?: string | number;")
            lines.append(f"  {f.name}To?: string | number;")
    lines += ["  /** first row (server paging) */", "  start?: number;", "  /** rows per page (server paging) */", "  limit?: number;",
              "  /** JSON [{ property, direction }] */", "  sort?: string;", "}", "",
              f"export interface {T}Page {{ data: {T}[]; total: number }}", ""]
    out.append(GeneratedFile("app", f"{base}/types/{ef}.generated.ts", "\n".join(lines), source=src))

    # ---- API service
    placeholders = re.findall(r"\{(\w+)\}", e.endpoint)
    scope = f"scope: {{ {', '.join(f'{p}: string | number' for p in placeholders)} }}, " if placeholders else ""
    scope_arg = "scope, " if placeholders else ""
    path_expr = "path(scope)" if placeholders else "ENDPOINT"
    audit_type = e.backend.auditEntityType or e.label
    svc = [
        ts_banner(src),
        "import type { ApiClient } from '@extreact/framework';",
        f"import type {{ {T}, {T}Changes, {T}Input, {T}Page, {T}Query }} from '../types/{ef}.generated';",
        "",
        f"export const {constant(e.name)}_ENDPOINT = {_lit(e.endpoint)};",
        f"const ENDPOINT = {constant(e.name)}_ENDPOINT;",
    ]
    if placeholders:
        svc.append("const path = (scope: Record<string, string | number>) => ENDPOINT.replace(/\\{(\\w+)\\}/g, (_, k: string) => encodeURIComponent(String(scope[k])));")
    svc += [
        "",
        "/** One row of the audit trail for this entity. */",
        "export interface AuditRow { id: number; action: 'INSERT' | 'UPDATE' | 'DELETE'; user: string; at: string; changed: string; reason?: string }",
        "",
        f"/** Typed calls to the {e.label} API; every call carries the signed-in user's token (the shell's ApiClient). */",
        f"export function {camel(e.name)}Api(api: ApiClient) {{",
        f"  const item = ({scope}id: number | string) => `${{{path_expr}}}/${{encodeURIComponent(String(id))}}`;",
        "  return {",
        f"    async list({scope}query: {T}Query = {{}}): Promise<{T}Page> {{",
        f"      const env = await api.get<any>({path_expr}, query as Record<string, string | number | boolean>, {{ raw: true }});",
        "      const data = Array.isArray(env) ? env : env?.data ?? [];",
        "      return { data, total: Number(Array.isArray(env) ? data.length : env?.total ?? data.length) };",
        "    },",
        f"    get: ({scope}id: number | string) => api.get<{T}>(item({scope_arg}id)),",
        f"    create: ({scope}input: {T}Input) => api.post<{T}>({path_expr}, input),",
        f"    update: ({scope}id: number | string, changes: {T}Changes) => api.put<{T}>(item({scope_arg}id), changes),",
        f"    remove: ({scope}id: number | string) => api.del<null>(item({scope_arg}id)),",
        f"    history: (id: number | string) => api.get<AuditRow[]>('/audit', {{ entityType: {_lit(audit_type)}, entityId: String(id) }}),",
    ]
    for a in e.backend.customActions:
        svc.append(f"    {camel(a)}: ({scope}id: number | string, body: Record<string, unknown> = {{}}) => api.post<{T}>(`${{item({scope_arg}id)}}/{a}`, body),")
    svc += ["  };", "}", ""]
    out.append(GeneratedFile("app", f"{base}/services/{ef}.api.generated.ts", "\n".join(svc), source=src))

    # ---- entity schema (framework FieldDef / ColumnDef for every field)
    fields = [field_def(e, f) for f in e.fields]
    from .schema import Column  # local: avoid a cycle at import time
    cols = [column_def(e, Column(field=f.name)) for f in e.fields]
    sch = [
        ts_banner(src),
        "import type { ColumnDef, FieldDef } from '@extreact/framework';",
        "",
        f"export const {constant(e.name)} = {ts({'entity': e.label, 'plural': e.plural, 'endpoint': e.endpoint, 'idField': e.idField, 'titleField': e.titleField, 'permissions': e.permissions.model_dump()})} as const;",
        "",
        f"/** Every {e.label} field with its rules (the server checks the same rules again). */",
        f"export const {camel(e.name)}Fields: FieldDef[] = {ts(fields)};",
        "",
        f"/** A grid column for every {e.label} field. */",
        f"export const {camel(e.name)}Columns: ColumnDef[] = {ts(cols)};",
        "",
    ]
    out.append(GeneratedFile("app", f"{base}/{ef}.schema.generated.ts", "\n".join(sch), source=src))
    return out


def _hooks_body(ws: Workspace, d: DisplaySchema) -> list[str]:
    _, hooks_type = factory(d)
    lines = [f"import type {{ {hooks_type} }} from '@extreact/framework';", ""]
    lines.append(f"/**\n * Code for “{d.title}”. UI Forge created this file once and never changes it: it is yours.\n *")
    if d.type == "entry":
        lines += [" * afterLoad / beforeSave / afterSave   reshape what is loaded and saved; throw to stop a save",
                  " * validators                           named field validators (FieldDef.validator)",
                  " * validate                             cross-field rules: return { field: message }",
                  " * onAction                             custom actions without a path",
                  " * renderExtra                          extra content under the form"]
    elif d.type == "summary":
        lines += [" * onAction       custom toolbar / row actions without a path",
                  " * transformRows  change rows after loading (computed columns)",
                  " * rowClass       CSS class per row (xg-row-muted, xg-row-warn, xg-row-danger, xg-row-success)"]
    else:
        lines += [" * master      Summary hooks of the master list",
                  " * detailList  Summary hooks of the child list (relation 'child')",
                  " * detail      Entry hooks of the detail form"]
    lines += [" */"]
    entry_layouts = [d.entry] if d.type == "entry" else [d.masterSlave.detail.entry] if d.type == "master-slave" else []
    validators = sorted({it.validator for lay in entry_layouts for s in lay.sections for it in s.items if it.validator})
    customs = []
    for lay in entry_layouts:
        customs += [a.id for a in lay.actions if a.kind == "custom" and not a.path]
    if d.type == "summary":
        customs += [a.id for a in d.summary.toolbarActions + d.summary.rowActions if a.kind == "custom" and not a.path]
    if d.type == "master-slave":
        customs_ms = [a.id for a in d.masterSlave.master.summary.toolbarActions + d.masterSlave.master.summary.rowActions if a.kind == "custom" and not a.path]
    body: list[str] = []
    if d.type in ("entry",):
        body += _entry_hooks(validators, customs, "  ")
    elif d.type == "summary":
        if customs:
            body += ["  onAction: async (actionId, ctx) => {", "    switch (actionId) {"]
            for c in sorted(set(customs)):
                body += [f"      case {_lit(c)}:", f"        ctx.shell.notify({_lit(c + ': not implemented yet')}, 'warning');", "        break;"]
            body += ["      default:", "        break;", "    }", "  },"]
        else:
            body += ["  // onAction: async (actionId, ctx) => { ... },"]
        body += ["  // transformRows: (rows) => rows,", "  // rowClass: (record) => undefined,"]
    else:
        body += ["  master: {"]
        if customs_ms:
            body += ["    onAction: async (actionId, ctx) => {", "      ctx.shell.notify(`${actionId}: not implemented yet`, 'warning');", "    },"]
        body += ["  },", "  detailList: {},", "  detail: {"]
        body += _entry_hooks(validators, customs, "    ")
        body += ["  },"]
    lines += [f"export const hooks: {hooks_type} = {{"] + body + ["};", ""]
    return lines


def _entry_hooks(validators: list[str], customs: list[str], ind: str) -> list[str]:
    out = [f"{ind}// afterLoad: (record) => record,", f"{ind}// beforeSave: async (values, ctx) => values,", f"{ind}// afterSave: (saved, ctx) => {{}},"]
    if validators:
        out.append(f"{ind}validators: {{")
        for v in validators:
            out += [f"{ind}  {v}: (value, values, field) => {{", f"{ind}    // return a message when the value is not acceptable", f"{ind}    return null;", f"{ind}  }},"]
        out.append(f"{ind}}},")
    else:
        out.append(f"{ind}// validators: {{ myRule: (value, values, field) => null }},")
    out.append(f"{ind}// validate: (values) => ({{}}),")
    if customs:
        out += [f"{ind}onAction: async (actionId, ctx) => {{", f"{ind}  switch (actionId) {{"]
        for c in sorted(set(customs)):
            out += [f"{ind}    case {_lit(c)}:", f"{ind}      ctx.shell.notify({_lit(c + ': not implemented yet')}, 'warning');", f"{ind}      break;"]
        out += [f"{ind}    default:", f"{ind}      break;", f"{ind}  }}", f"{ind}}},"]
    return out


def _display_files(ws: Workspace, d: DisplaySchema, audit_endpoint: str) -> list[GeneratedFile]:
    src = display_path(d)
    folder = display_folder(d.name)
    base = f"src/modules/{d.module}/displays/{folder}"
    fac, hooks_type = factory(d)
    cfg = display_config(ws, d, audit_endpoint)
    ctype = config_type(d)
    out = [GeneratedFile("app", f"{base}/{folder}.config.generated.ts", "\n".join([
        ts_banner(src, f"{folder}.hooks.ts and {d.name}.tsx"),
        f"import type {{ {ctype} }} from '@extreact/framework';",
        "",
        f"/** Registry id of “{d.title}” ({d.registry_type}). */",
        f"export const DISPLAY_ID = {_lit(d.id)};",
        "",
        f"export const config: {ctype} = {ts(cfg)};",
        "",
    ]), source=src)]
    comp = [
        f"/**\n * {d.title} ({d.registry_type}). UI Forge created this component once; it is yours to change.\n"
        f" * Layout and fields come from {folder}.config.generated.ts (regenerated from {src});\n"
        f" * add behaviour in {folder}.hooks.ts, or replace the template entirely.\n */",
        f"import {{ {fac} }} from '@extreact/framework';",
        f"import {{ config }} from './{folder}.config.generated';",
        f"import {{ hooks }} from './{folder}.hooks';",
        "",
        f"const {d.name} = {fac}(config, hooks);",
        f"export default {d.name};",
        "",
    ]
    out.append(GeneratedFile("app", f"{base}/{d.name}.tsx", "\n".join(comp), owner="developer", source=src))
    out.append(GeneratedFile("app", f"{base}/{folder}.hooks.ts", "\n".join(_hooks_body(ws, d)), owner="developer", source=src))
    return out


def registry_file(ws: Workspace) -> GeneratedFile:
    lines = [
        ts_banner("every src/modules/*/ui-forge/*.display.json", "the display components"),
        "import { defineDisplays } from '@extreact/framework';",
        "",
        "/** The approved implementations of every UI Forge display (merged into src/displays.ts). */",
        "export const generatedDisplays = defineDisplays({",
    ]
    for d in sorted(ws.displays.values(), key=lambda x: x.name):
        if not d.generator.frontend:
            continue
        folder = display_folder(d.name)
        lines.append(f"  {d.name}: {{ load: () => import('./{d.module}/displays/{folder}/{d.name}'), types: [{_lit(d.registry_type)}] }},")
    lines += ["});", ""]
    return GeneratedFile("app", "src/modules/generated-displays.ts", "\n".join(lines), source="workspace")


def wire_displays_ts(text: str) -> tuple[str, str | None]:
    """src/displays.ts with the generated registry merged in. Returns (new text, problem or None). Idempotent."""
    if IMPORT_BEGIN in text and REG_BEGIN in text:
        return text, None
    out = text
    if IMPORT_BEGIN not in out:
        imports = list(re.finditer(r"^import [^;]+;\s*$", out, re.M))
        if not imports:
            return text, "src/displays.ts has no import statements to add the generated registry after"
        at = imports[-1].end()
        block = f"\n{IMPORT_BEGIN}\nimport {{ generatedDisplays }} from './modules/generated-displays';\n{IMPORT_END}"
        out = out[:at] + block + out[at:]
    if REG_BEGIN not in out:
        m = re.search(r"mergeDisplays\(", out)
        if not m:
            return text, "src/displays.ts does not call mergeDisplays(...); add generatedDisplays to the registry by hand"
        depth, i = 1, m.end()
        while i < len(out) and depth:
            depth += {"(": 1, ")": -1}.get(out[i], 0)
            i += 1
        close = i - 1
        line_start = out.rfind("\n", 0, close) + 1
        before = out[:close].rstrip()
        if not before.endswith(",") and not before.endswith("(") and not before.split("\n")[-1].strip().startswith("//"):
            out = before + "," + out[len(before):]
            close += 1
            line_start = out.rfind("\n", 0, close) + 1
        block = f"  {REG_BEGIN}\n  generatedDisplays,\n  {REG_END}\n"
        if out[line_start:close].strip() == "":
            out = out[:line_start] + block + out[line_start:]
        else:
            out = out[:close] + "\n" + block + out[close:]
    return out, None


def frontend_files(ws: Workspace, audit_endpoint: str = "/audit", only: set[str] | None = None) -> list[GeneratedFile]:
    files: list[GeneratedFile] = []
    used = {n for d in ws.displays.values() if d.generator.frontend for n in d.entities()}
    for e in sorted(ws.entities.values(), key=lambda x: x.name):
        if e.name in used or only is None:
            files += _entity_files(ws, e)
    for d in sorted(ws.displays.values(), key=lambda x: x.id):
        if d.generator.frontend:
            files += _display_files(ws, d, audit_endpoint)
    files.append(registry_file(ws))
    return files
