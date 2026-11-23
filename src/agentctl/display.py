"""agentctl display — register front-end modules (menus and displays) with the display registry.

    agentctl display validate registration/*.manifest.json
    agentctl display register registration/gridtrade.core.manifest.json registration/gridtrade.reference.manifest.json \\
        --registry http://localhost:8130 --app-api http://localhost:5080/api --user admin
    agentctl display status gridtrade.core --app gridtrade --registry ... --app-api ... --user admin

Registration signs in to the application (its own users and permissions decide who may register), then sends
each manifest to the registry, which validates it again and upserts it in one transaction. Manifests are data:
nothing in them is executed. Use --dry-run to see the changes without saving them.

Credentials: --password-env NAME reads the password from that environment variable; otherwise you are prompted.
A token can be given instead with --token-env NAME (for deployment pipelines).
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx


def _fail(msg: str, code: int = 2) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def _load(path: str) -> dict[str, Any]:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        _fail(f"{path} not found")
    except json.JSONDecodeError as e:
        _fail(f"{path} is not valid JSON: {e}")
    return {}


def _local_check(path: str, raw: dict[str, Any]) -> list[str]:
    try:
        from display_registry.manifest import ModuleManifest
    except ImportError:  # registry package not installed: the server still validates
        return []
    from pydantic import ValidationError
    try:
        ModuleManifest.model_validate(raw)
    except ValidationError as e:
        return [f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()]
    return []


def _token(args: argparse.Namespace) -> str:
    if args.token_env:
        tok = os.environ.get(args.token_env)
        if not tok:
            _fail(f"environment variable {args.token_env} is empty")
        return tok
    if not args.app_api or not args.user:
        _fail("give --app-api and --user to sign in, or --token-env")
    password = os.environ.get(args.password_env) if args.password_env else None
    if password is None:
        password = getpass.getpass(f"Password for {args.user}: ")
    url = args.app_api.rstrip("/") + "/" + args.login_path.lstrip("/")
    try:
        r = httpx.post(url, json={"username": args.user, "password": password}, timeout=15)
    except httpx.HTTPError as e:
        _fail(f"cannot reach {url}: {e}")
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200:
        _fail(f"sign-in failed ({r.status_code}): {body.get('message', r.text[:200])}")
    data = body.get("data", body)
    if not data.get("token"):
        _fail("sign-in response has no token")
    return data["token"]


def _print_report(rep: dict[str, Any]) -> None:
    head = f"{rep.get('module')} {rep.get('version')}: {rep.get('status')}" + (" (dry run)" if rep.get("dryRun") else "")
    print(head)
    for c in rep.get("changes", []):
        fields = f" [{', '.join(c['fields'])}]" if c.get("fields") else ""
        print(f"  {c['change']:<20} {c['kind']:<8} {c['id']}{fields}")
    for w in rep.get("warnings", []):
        print(f"  warning: {w}")
    for e in rep.get("errors", []):
        print(f"  error:   {e}")


def cmd_validate(args: argparse.Namespace) -> None:
    bad = 0
    for path in args.manifests:
        raw = _load(path)
        errors = _local_check(path, raw)
        if errors:
            bad += 1
            print(f"{path}: invalid")
            for e in errors:
                print(f"  error: {e}")
            continue
        if args.registry:
            token = _token(args)
            r = httpx.post(f"{args.registry.rstrip('/')}/api/v1/apps/{raw['app']}/modules/validate",
                           json={"manifest": raw, "prune": args.prune}, headers={"Authorization": f"Bearer {token}"}, timeout=30)
            body = r.json()
            if r.status_code != 200 or not body.get("valid"):
                bad += 1
                print(f"{path}: rejected by the registry")
                for e in body.get("errors", [body.get("message", "")]):
                    print(f"  error: {e}")
                continue
            for w in body.get("warnings", []):
                print(f"  warning: {w}")
        print(f"{path}: ok ({len(raw.get('displays', []))} displays, {len(raw.get('menus', []))} menu entries)")
    raise SystemExit(1 if bad else 0)


def cmd_register(args: argparse.Namespace) -> None:
    manifests = [(p, _load(p)) for p in args.manifests]
    for p, raw in manifests:
        errors = _local_check(p, raw)
        if errors:
            print(f"{p}: invalid")
            for e in errors:
                print(f"  error: {e}")
            raise SystemExit(1)
    token = _token(args)
    failed = False
    for p, raw in manifests:
        url = f"{args.registry.rstrip('/')}/api/v1/apps/{raw['app']}/modules/register"
        try:
            r = httpx.post(url, json={"manifest": raw, "prune": args.prune, "overrideAdminChanges": args.override_admin_changes,
                                      "dryRun": args.dry_run}, headers={"Authorization": f"Bearer {token}"}, timeout=60)
        except httpx.HTTPError as e:
            _fail(f"cannot reach the registry at {url}: {e}")
        body = r.json()
        if r.status_code in (200, 422) and "status" in body:
            _print_report(body)
            failed = failed or bool(body.get("errors"))
        else:
            print(f"{p}: {r.status_code} {body.get('message') or body}")
            failed = True
        if failed:
            break  # later manifests may depend on this one
    raise SystemExit(1 if failed else 0)


def cmd_status(args: argparse.Namespace) -> None:
    token = _token(args)
    r = httpx.get(f"{args.registry.rstrip('/')}/api/v1/apps/{args.app}/modules/{args.module}",
                  headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code != 200:
        _fail(f"{r.status_code} {r.json().get('message')}", 1)
    print(json.dumps(r.json(), indent=2))


def add_commands(sub: Any) -> None:
    p = sub.add_parser("display", help="Register front-end modules (menus and displays) with the display registry")
    dsub = p.add_subparsers(dest="display_command", required=True)

    def conn(sp: argparse.ArgumentParser, registry_required: bool) -> None:
        sp.add_argument("--registry", required=registry_required, default=os.getenv("DISPLAY_REGISTRY_URL"),
                        help="display registry base URL, e.g. http://localhost:8130")
        sp.add_argument("--app-api", default=os.getenv("APP_API_URL"), help="the application's API, used to sign in")
        sp.add_argument("--login-path", default="/auth/login")
        sp.add_argument("--user", default=os.getenv("APP_USER"))
        sp.add_argument("--password-env", help="environment variable holding the password (otherwise prompted)")
        sp.add_argument("--token-env", help="environment variable holding a token (skips sign-in)")

    v = dsub.add_parser("validate", help="check manifests locally, and with --registry also against the registry")
    v.add_argument("manifests", nargs="+")
    v.add_argument("--prune", action="store_true")
    conn(v, registry_required=False)
    v.set_defaults(func=cmd_validate)

    r = dsub.add_parser("register", help="register manifests in the order given (folders first)")
    r.add_argument("manifests", nargs="+")
    r.add_argument("--dry-run", action="store_true", help="report the changes without saving them")
    r.add_argument("--prune", action="store_true", help="disable entries this module no longer declares")
    r.add_argument("--override-admin-changes", action="store_true", help="overwrite fields an administrator changed")
    conn(r, registry_required=True)
    r.set_defaults(func=cmd_register)

    s = dsub.add_parser("status", help="show a registered module and its history")
    s.add_argument("module")
    s.add_argument("--app", required=True)
    conn(s, registry_required=True)
    s.set_defaults(func=cmd_status)
