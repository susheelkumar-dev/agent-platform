"""ui-forge: design, validate and generate Entry, Summary and Master-Slave displays for a framework-shell React app.

    ui-forge serve    --app ../gridtrade-react [--mirror DIR] [--api ../gridtrade-contracts-extjs]
    ui-forge stage    <display-id> [--out DIR]   (review folder with a README; nothing goes into the project)
    ui-forge validate [display-id ...]
    ui-forge plan     [--diff] [--json] [--check]
    ui-forge apply    [--yes] [--force root:path ...] [--prune]
    ui-forge check    [--user admin]
    ui-forge register --user admin [--password-env NAME] [--dry-run]
    ui-forge test     [--build] [--api]
    ui-forge list | schema | export <id> | import <file.json>

--app / --api / --mirror can also come from UI_FORGE_APP / UI_FORGE_API / UI_FORGE_MIRROR or ui-forge.config.json.
Exit codes: 0 ok, 1 validation or test failure, 2 usage or configuration error, 3 conflicts left unapplied,
4 plan --check found pending changes.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

from . import checks
from .plan import StalePlan, apply, plan
from .project import inspect, load_project
from .schema import json_schemas
from .semantic import check, has_errors
from .workspace import load_workspace, overlay, save_documents

C = {"create": "\033[32m", "update": "\033[36m", "conflict": "\033[31m", "orphan": "\033[33m", "retire": "\033[35m", "keep": "\033[2m", "unchanged": "\033[2m", "end": "\033[0m"}


def _c(status: str, text: str) -> str:
    if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
        return text
    return C.get(status, "") + text + C["end"]


def _project(a: argparse.Namespace):
    try:
        return load_project(a.app, a.api, a.mirror)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(2)


def _issues(issues) -> bool:
    for i in issues:
        print(f"  {_c('conflict' if i.level == 'error' else 'orphan', i.level):<8} {i.where} {i.path}: {i.message}")
    return has_errors(issues)


def cmd_validate(a):
    p = _project(a)
    ws = load_workspace(p)
    issues = check(p, ws, inspect(p), set(a.ids) if a.ids else None)
    bad = _issues(issues)
    print(f"{len(ws.displays)} display(s), {len(ws.entities)} entit(ies): {'invalid' if bad else 'valid'}"
          f" ({sum(i.level == 'error' for i in issues)} error(s), {sum(i.level == 'warning' for i in issues)} warning(s))")
    raise SystemExit(1 if bad else 0)


def _plan(a, p, ws):
    pl = plan(p, ws, prune=getattr(a, "prune", False))
    for c in sorted(pl.changes, key=lambda x: (x.root, x.path)):
        if c.status == "unchanged" and not a.verbose:
            continue
        print(f"  {_c(c.status, c.status):<18} {c.owner:<10} {c.root}:{c.path}" + (f"  ({c.note})" if c.note and (c.status in ("conflict", "orphan", "create") and c.owner != "developer" or c.status == "retire") else ""))
        if getattr(a, "diff", False) and c.status in ("update", "conflict"):
            print(c.diff())
    for pr in pl.problems:
        print(f"  {_c('conflict', 'problem')}  {pr}")
    counts = ", ".join(f"{v} {k}" for k, v in sorted(pl.counts().items()))
    print(f"plan {pl.hash}: {counts or 'nothing'}")
    return pl


def cmd_plan(a):
    p = _project(a)
    ws = load_workspace(p)
    issues = check(p, ws, inspect(p))
    if has_errors(issues):
        _issues(issues)
        raise SystemExit(1)
    if a.json:
        pl = plan(p, ws, prune=a.prune)
        print(json.dumps(pl.as_dict(), indent=2))
    else:
        pl = _plan(a, p, ws)
    if a.check and any(c.status not in ("unchanged", "keep") for c in pl.changes):
        raise SystemExit(4)


def cmd_apply(a):
    p = _project(a)
    ws = load_workspace(p)
    issues = check(p, ws, inspect(p))
    if _issues([i for i in issues if i.level == "error"]):
        raise SystemExit(1)
    pl = _plan(a, p, ws)
    if pl.problems:
        raise SystemExit(2)
    todo = [c for c in pl.changes if c.status in ("create", "update") or (c.status == "conflict" and c.key in set(a.force)) or (c.status in ("orphan", "retire") and a.prune)]
    if not todo:
        apply(p, ws, pl.hash, set(), False)  # writes only the lock (records which files are yours)
        print("Nothing to write.")
        conflicts = [c for c in pl.changes if c.status == "conflict"]
        raise SystemExit(3 if conflicts else 0)
    if not a.yes:
        if input(f"Write {len(todo)} file(s)? [y/N] ").strip().lower() not in ("y", "yes"):
            raise SystemExit(0)
    try:
        res, _ = apply(p, ws, pl.hash, set(a.force), a.prune)
    except StalePlan as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(2)
    print(f"Wrote {len(res.written)} file(s)" + (f", backed up {len(res.backups)}" if res.backups else "") +
          (f", deleted {len(res.deleted)}" if res.deleted else "") +
          (f", moved {len(res.retired)} of your files to .ui-forge/retired" if res.retired else "") + ".")
    if res.skipped:
        print(f"Kept {len(res.skipped)} file(s) you edited (conflicts): " + ", ".join(res.skipped))
        print("Move your changes into the hooks / component files, or rerun with --force <key> to overwrite (a backup is made).")
        raise SystemExit(3)


def _token(a, p) -> str | None:
    if getattr(a, "token_env", None):
        return os.environ.get(a.token_env)
    if not getattr(a, "user", None):
        return None
    pw = os.environ.get(a.password_env) if a.password_env else None
    if pw is None:
        pw = getpass.getpass(f"Password for {a.user}: ")
    try:
        return checks.sign_in(p, a.user, pw)
    except Exception as e:  # noqa: BLE001
        print(f"error: sign-in failed: {e}", file=sys.stderr)
        raise SystemExit(2)


def cmd_check(a):
    p = _project(a)
    ws = load_workspace(p)
    items = checks.checklist(p, ws, inspect(p), _token(a, p))
    for it in items:
        mark = {"ok": _c("create", "done"), "todo": _c("conflict", "todo"), "unknown": _c("orphan", "?   ")}[it["status"]]
        print(f"  {mark}  {it['title']}" + (f": {it['detail']}" if it["detail"] else "") + (f"\n        -> {it['fix']}" if it["status"] != "ok" and it["fix"] else ""))
    raise SystemExit(0 if all(i["status"] == "ok" for i in items) else 1)


def cmd_register(a):
    p = _project(a)
    token = _token(a, p)
    if not token:
        print("error: give --user (or --token-env)", file=sys.stderr)
        raise SystemExit(2)
    bad = 0
    for r in checks.register(p, token, a.dry_run):
        rep = r["report"]
        print(f"{r['file']}: {rep.get('status', r['status'])}" + (" (dry run)" if a.dry_run else ""))
        for c in rep.get("changes", []):
            print(f"  {c['change']:<20} {c['kind']:<8} {c['id']}")
        for e in rep.get("errors", []) + ([rep["message"]] if r["status"] >= 400 and rep.get("message") else []):
            bad += 1
            print(f"  error: {e}")
    raise SystemExit(1 if bad else 0)


def cmd_test(a):
    p = _project(a)
    ok = True
    if a.api or not a.build:
        r = checks.run_backend_tests(p)
        print(r["output"])
        ok &= r["ok"]
    if a.build or not a.api:
        r = checks.run_build(p)
        print(r["output"])
        ok &= r["ok"]
    raise SystemExit(0 if ok else 1)


def cmd_list(a):
    p = _project(a)
    ws = load_workspace(p)
    for e in sorted(ws.entities.values(), key=lambda x: x.name):
        print(f"entity   {e.name:<28} {e.endpoint:<28} {ws.files['entity:' + e.name]}")
    for d in sorted(ws.displays.values(), key=lambda x: x.id):
        print(f"display  {d.id:<28} {d.type:<13} {d.title:<28} {ws.files['display:' + d.id]}")
    for i in ws.issues:
        print(f"  error {i.where}: {i.message}")


def cmd_schema(a):
    print(json.dumps(json_schemas(), indent=2))


def cmd_export(a):
    p = _project(a)
    ws = load_workspace(p)
    d = ws.displays.get(a.id)
    if not d:
        print(f"error: no display {a.id}", file=sys.stderr)
        raise SystemExit(2)
    doc = {"display": d.model_dump(mode="json", exclude_none=True),
           "entities": [ws.entities[n].model_dump(mode="json", exclude_none=True) for n in d.entities() if n in ws.entities]}
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    if a.output:
        Path(a.output).write_text(text, encoding="utf-8")
    else:
        print(text)


def cmd_import(a):
    p = _project(a)
    ws = load_workspace(p)
    doc = json.loads(Path(a.file).read_text(encoding="utf-8"))
    ents, disps = doc.get("entities", []), ([doc["display"]] if "display" in doc else doc.get("displays", []))
    if doc.get("kind") == "entity":
        ents = [doc]
    if doc.get("kind") == "display":
        disps = [doc]
    new_ws, shape = overlay(ws, ents, disps)
    issues = shape + check(p, new_ws, inspect(p))
    if _issues(issues):
        raise SystemExit(1)
    names = {e["name"] for e in ents}
    ids = {d["id"] for d in disps}
    written = save_documents(p, ws, [new_ws.entities[n] for n in names], [new_ws.displays[i] for i in ids])
    print("Saved " + ", ".join(written))


def cmd_stage(a):
    from .stage import stage
    p = _project(a)
    ws = load_workspace(p)
    errs = [i for i in check(p, ws, inspect(p), {a.id}) if i.level == "error"]
    if _issues(errs):
        raise SystemExit(1)
    try:
        res = stage(p, ws, a.id, Path(a.out) if a.out else None)
    except KeyError as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(2) from e
    print(f"Staged {len(res.files)} file(s) in {res.folder}")
    if res.previous:
        print(f"The previous staging was moved to {res.previous}")
    print(f"Next: read {res.folder / 'README.md'}")


def cmd_serve(a):
    p = _project(a)
    from .service import run
    run(p, a.host, a.port, a.open)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="ui-forge", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", help="the framework-shell React app (UI_FORGE_APP)")
    ap.add_argument("--api", help="the backend repository with server/server.js (UI_FORGE_API)")
    ap.add_argument("--mirror", help="the app-files folder to keep in step (UI_FORGE_MIRROR)")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="the visual builder (http://127.0.0.1:8140)")
    s.add_argument("--host", default=os.environ.get("UI_FORGE_HOST", "127.0.0.1"))
    s.add_argument("--port", type=int, default=int(os.environ.get("UI_FORGE_PORT", "8140")))
    s.add_argument("--open", action="store_true", help="open the browser")
    s.set_defaults(fn=cmd_serve)
    s = sub.add_parser("stage", help="write one display's code to <app>/ui-forge-out/<id>/ with a README (not into the project)")
    s.add_argument("id")
    s.add_argument("--out", help="staging root (default <app>/ui-forge-out)")
    s.set_defaults(fn=cmd_stage)
    s = sub.add_parser("validate", help="check schemas against each other and the application")
    s.add_argument("ids", nargs="*")
    s.set_defaults(fn=cmd_validate)
    s = sub.add_parser("plan", help="show what generation would write")
    s.add_argument("--diff", action="store_true")
    s.add_argument("--json", action="store_true")
    s.add_argument("--prune", action="store_true")
    s.add_argument("--check", action="store_true", help="exit 4 when generated files are not up to date (for CI)")
    s.set_defaults(fn=cmd_plan)
    s = sub.add_parser("apply", help="write the generated files")
    s.add_argument("--yes", "-y", action="store_true")
    s.add_argument("--force", action="append", default=[], metavar="ROOT:PATH", help="overwrite a file edited by hand (backed up first)")
    s.add_argument("--prune", action="store_true", help="delete generated files no schema produces any more (unedited only)")
    s.add_argument("--diff", action="store_true")
    s.set_defaults(fn=cmd_apply)
    for name, fn, hlp in (("check", cmd_check, "integration checklist"), ("register", cmd_register, "send menus and displays to the display registry")):
        s = sub.add_parser(name, help=hlp)
        s.add_argument("--user")
        s.add_argument("--password-env")
        s.add_argument("--token-env")
        if name == "register":
            s.add_argument("--dry-run", action="store_true")
        s.set_defaults(fn=fn)
    s = sub.add_parser("test", help="run the generated API tests and/or tsc --noEmit")
    s.add_argument("--api", action="store_true")
    s.add_argument("--build", action="store_true")
    s.set_defaults(fn=cmd_test)
    sub.add_parser("list", help="schemas in the workspace").set_defaults(fn=cmd_list)
    sub.add_parser("schema", help="print the JSON Schema of entity and display documents").set_defaults(fn=cmd_schema)
    s = sub.add_parser("export", help="a display and its entities as one JSON document")
    s.add_argument("id")
    s.add_argument("-o", "--output")
    s.set_defaults(fn=cmd_export)
    s = sub.add_parser("import", help="validate and save a document made by export (or a single entity / display)")
    s.add_argument("file")
    s.set_defaults(fn=cmd_import)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
