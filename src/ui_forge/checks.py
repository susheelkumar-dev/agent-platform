"""Integration checklist: what still needs doing before a designed display works in the application."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import httpx

from .gen_frontend import IMPORT_BEGIN, REG_BEGIN
from .plan import plan
from .project import Inventory, Project
from .semantic import check as semantic_check
from .semantic import has_errors
from .workspace import Workspace


def _item(id_: str, title: str, ok: bool | None, detail: str = "", fix: str = "") -> dict[str, Any]:
    return {"id": id_, "title": title, "status": "ok" if ok else "todo" if ok is False else "unknown", "detail": detail, "fix": fix}


def checklist(project: Project, ws: Workspace, inv: Inventory, token: str | None = None) -> list[dict[str, Any]]:
    items = []
    issues = semantic_check(project, ws, inv)
    errs = [i for i in issues if i.level == "error"]
    items.append(_item("schema", "Schemas are valid", not has_errors(issues),
                       f"{len(errs)} error(s)" if errs else f"{len(ws.displays)} display(s), {len(ws.entities)} entit(ies)",
                       "Fix the errors shown in Validate"))
    if not has_errors(issues):
        p = plan(project, ws)
        pending = [c for c in p.changes if c.status in ("create", "update")]
        conflicts = [c for c in p.changes if c.status == "conflict"]
        items.append(_item("files", "Generated files are up to date", not pending and not conflicts and not p.problems,
                           f"{len(pending)} to write, {len(conflicts)} conflict(s)" if pending or conflicts else "all files match the schemas",
                           "Generate: review the plan and apply it"))
    text = (project.app_root / "src" / "displays.ts").read_text(encoding="utf-8")
    items.append(_item("registry", "src/displays.ts includes the generated displays", IMPORT_BEGIN in text and REG_BEGIN in text,
                       "", "Generate writes the two ui-forge blocks"))
    if project.backend_kind == "gridtrade-node":
        node = shutil.which("node")
        idx = project.api_root / "server" / "generated" / "index.js"
        ok = None
        detail = ""
        if node and idx.is_file():
            r = subprocess.run([node, "-e", "const g=require(process.argv[1]);console.log(JSON.stringify(g.permissionModules.map(m=>m.module)))", str(idx)],
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
            ok = r.returncode == 0
            detail = r.stdout.strip() if ok else r.stderr.strip()[-400:]
        items.append(_item("backend", "Backend modules load", ok, detail, "Generate, then fix the error shown"))
        status = 0
        try:
            r = httpx.get(project.app_api_url.rstrip("/") + "/permissions", timeout=3, headers={"Authorization": f"Bearer {token}"} if token else {})
            status = r.status_code
            served = {m["module"] for m in (r.json().get("data") or [])} if r.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            served = None
        wanted = {e.permissionModule.module for e in ws.entities.values() if e.permissionModule}
        if served is None:
            detail = "the API is running; sign in to check it" if status == 401 else f"{project.app_api_url} is not reachable"
            items.append(_item("api", "The running API serves the generated modules", None, detail,
                               "Sign in" if status == 401 else "Start (or restart) the API: scripts\\start-local.ps1"))
        else:
            missing = sorted(wanted - served)
            items.append(_item("api", "The running API serves the generated modules", not missing,
                               f"missing permission module(s): {', '.join(missing)}" if missing else "permissions and routes are live",
                               "Restart the API so it loads server/generated"))
    if token:
        try:
            r = httpx.get(f"{project.registry_url.rstrip('/')}/api/v1/apps/{project.app_id}/navigation", timeout=5,
                          headers={"Authorization": f"Bearer {token}"})
            have = set((r.json().get("displays") or {}).keys()) if r.status_code == 200 else set()
            missing = sorted(set(ws.displays) - have)
            items.append(_item("menus", "Menus and displays are registered", r.status_code == 200 and not missing,
                               f"not registered (or not allowed for you): {', '.join(missing)}" if missing else "all displays are in the registry",
                               "Register (signs in to the application and sends the manifests)"))
        except httpx.HTTPError as e:
            items.append(_item("menus", "Menus and displays are registered", None, f"registry not reachable: {e}", "Start the display registry"))
    else:
        items.append(_item("menus", "Menus and displays are registered", None, "sign in to check", "Register"))
    return items


def run_build(project: Project, timeout: int = 600) -> dict[str, Any]:
    """tsc --noEmit in the app (what `npm run build` runs first)."""
    npx = shutil.which("npx")
    if not npx:
        return {"ok": False, "output": "npx not found: install Node.js"}
    if not (project.app_root / "node_modules").is_dir():
        return {"ok": False, "output": "node_modules is missing: run npm install in the app first"}
    r = subprocess.run([npx, "tsc", "--noEmit"], cwd=project.app_root, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout, env=dict(os.environ, FORCE_COLOR="0"))
    return {"ok": r.returncode == 0, "output": (r.stdout + r.stderr)[-6000:] or "tsc --noEmit: no errors"}


def run_backend_tests(project: Project, timeout: int = 300) -> dict[str, Any]:
    node = shutil.which("node")
    test = project.api_root / "server" / "generated" / "selftest.generated.js" if project.api_root else None
    if not node or not test or not test.is_file():
        return {"ok": False, "output": "no generated API tests (generate a backend first)"}
    r = subprocess.run([node, str(test)], cwd=project.api_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return {"ok": r.returncode == 0, "output": (r.stdout + r.stderr)[-8000:]}


def register(project: Project, token: str, dry_run: bool = False) -> list[dict[str, Any]]:
    """Sends UI Forge's manifests to the display registry (as agentctl display register does)."""
    out = []
    for p in sorted((project.app_root / "registration").glob(f"{project.app_id}.ui-forge.*.manifest.json")):
        man = json.loads(p.read_text(encoding="utf-8"))
        r = httpx.post(f"{project.registry_url.rstrip('/')}/api/v1/apps/{man['app']}/modules/register",
                       json={"manifest": man, "dryRun": dry_run}, headers={"Authorization": f"Bearer {token}"}, timeout=30)
        try:
            body = r.json()
        except ValueError:
            body = {"message": r.text[:300]}
        out.append({"file": f"registration/{p.name}", "status": r.status_code, "report": body})
    return out


def sign_in(project: Project, user: str, password: str) -> str:
    r = httpx.post(project.app_api_url.rstrip("/") + "/auth/login", json={"username": user, "password": password}, timeout=15)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200:
        raise PermissionError(body.get("message") or f"sign-in failed ({r.status_code})")
    return (body.get("data") or body)["token"]


def node_available() -> bool:
    return shutil.which("node") is not None


def app_relative(project: Project, p: Path) -> str:
    return p.relative_to(project.app_root).as_posix()
