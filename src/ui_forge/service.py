"""The UI Forge builder service: serves the builder (static SPA) and the API it uses.

It is a local developer tool: it binds to 127.0.0.1 by default, reads and writes only under the project's roots,
and, when UI_FORGE_TOKEN is set, requires that token in the X-UI-Forge-Token header of every API call.
Signing in to the application (for live preview data, registration and checks) happens through the
application's own API; the token stays in the browser and comes back in X-App-Token.
"""

from __future__ import annotations

import io
import json
import logging
import os
import secrets
import zipfile
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from . import __version__, checks
from .gen_frontend import ts
from .infer import infer_fields
from .plan import StalePlan, apply, desired_files, plan
from .project import Project, inspect
from .resolve import display_config, permissions_of
from .schema import SCHEMA_VERSION, json_schemas, parse_display, parse_entity
from .semantic import check, has_errors
from .stage import stage
from .workspace import Issue, load_workspace, overlay, save_documents

log = logging.getLogger("ui_forge")
STATIC = Path(__file__).parent / "static"


def _issues(items: list[Issue]) -> list[dict[str, str]]:
    return [i.as_dict() for i in items]


def create_app(project: Project) -> FastAPI:
    app = FastAPI(title="UI Forge", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
    token = os.environ.get("UI_FORGE_TOKEN") or None
    state: dict[str, Any] = {"inventory": None}

    def inv(refresh: bool = False):
        if refresh or state["inventory"] is None:
            state["inventory"] = inspect(project)
        return state["inventory"]

    @app.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path
        if path.startswith(("/api/", "/app-api/")) and path not in ("/api/health",) and token:
            if not secrets.compare_digest(request.headers.get("x-ui-forge-token", ""), token):
                return JSONResponse({"detail": "UI Forge token required (X-UI-Forge-Token)"}, status_code=401)
        return await call_next(request)

    def app_token(request: Request) -> str | None:
        return request.headers.get("x-app-token") or None

    def drafts(body: dict[str, Any]):
        ws = load_workspace(project)
        new_ws, shape = overlay(ws, body.get("entities") or [], body.get("displays") or [], body.get("replace") or {})
        for key in body.get("removed") or []:
            if key.startswith("display:"):
                new_ws.displays.pop(key[8:], None)
            if key.startswith("entity:"):
                new_ws.entities.pop(key[7:], None)
        return ws, new_ws, shape

    # ------------------------------------------------------------------ project
    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__, "schemaVersion": SCHEMA_VERSION}

    @app.get("/api/project")
    def get_project(refresh: bool = False):
        i = inv(refresh)
        return {"project": project.summary(), "inventory": i.as_dict(), "version": __version__, "schemaVersion": SCHEMA_VERSION,
                "tokenRequired": bool(token)}

    @app.get("/api/schema")
    def schema():
        return json_schemas()

    @app.get("/api/workspace")
    def workspace():
        ws = load_workspace(project)
        return ws.docs()

    # ------------------------------------------------------------------ drafts: validate, preview
    @app.post("/api/preview")
    def preview(body: dict[str, Any]):
        """Issues, framework configs and generated files for unsaved documents (nothing is written)."""
        ws, new_ws, shape = drafts(body)
        focus = set(body.get("focus") or [d["id"] for d in body.get("displays") or [] if isinstance(d, dict) and "id" in d]) or None
        issues = shape + check(project, new_ws, inv(), focus)
        configs: dict[str, Any] = {}
        metas: dict[str, Any] = {}
        files: list[dict[str, Any]] = []
        if not shape:
            for did in focus or []:
                d = new_ws.displays.get(did)
                if not d or any(n not in new_ws.entities for n in d.entities()):
                    continue
                try:
                    configs[did] = display_config(new_ws, d)
                    required, actions = permissions_of(new_ws, d)
                    metas[did] = {"id": d.id, "title": d.title, "type": d.registry_type, "key": d.name, "route": d.route or f"d/{d.id}",
                                  "openMode": d.openMode, "params": [{"name": "id", "required": True}] if d.type == "entry" else [],
                                  "icon": d.icon, "config": {}, "module": f"{project.app_id}.ui-forge.{d.module}",
                                  "requiredPermissions": required, "actionPermissions": actions}
                except Exception as e:  # noqa: BLE001 - a broken reference is already an issue
                    log.debug("config of %s failed: %s", did, e)
            if body.get("files", True):
                try:
                    gen, problems = desired_files(project, new_ws)
                    for f in gen:
                        if f.root == "mirror":
                            continue
                        exists = (project.root(f.root) / f.path).is_file()
                        files.append({"key": f.key, "root": f.root, "path": f.path, "owner": f.owner, "source": f.source,
                                      "content": f.content, "exists": exists})
                    for pr in problems:
                        issues.append(Issue("warning", "project", "", pr))
                except Exception as e:  # noqa: BLE001
                    issues.append(Issue("error", "generator", "", f"generation failed: {e}"))
        return {"issues": _issues(issues), "configs": configs, "metas": metas, "files": files}

    @app.post("/api/save")
    def save(body: dict[str, Any]):
        ws, new_ws, shape = drafts(body)
        if shape:
            return JSONResponse({"saved": [], "issues": _issues(shape)}, status_code=400)
        ents = [new_ws.entities[e["name"]] for e in body.get("entities") or []]
        disps = [new_ws.displays[d["id"]] for d in body.get("displays") or []]
        # a document whose content changed gets the next revision (manifest versions only go up)
        bumped_e, bumped_d = [], []
        for e in ents:
            old = ws.entities.get(e.name)
            if old and old.model_dump(exclude={"revision"}) != e.model_dump(exclude={"revision"}):
                e = e.model_copy(update={"revision": max(old.revision, e.revision) + 1})
            bumped_e.append(e)
        for d in disps:
            old = ws.displays.get(d.id) or next((ws.displays[k[8:]] for k, v in (body.get("replace") or {}).items() if k == "display:" + d.id and v.startswith("display:") and v[8:] in ws.displays), None)
            if old and old.model_dump(exclude={"revision"}) != d.model_dump(exclude={"revision"}):
                d = d.model_copy(update={"revision": max(old.revision, d.revision) + 1})
            bumped_d.append(d)
        removed = list(body.get("removed") or [])
        for new_key, old_key in (body.get("replace") or {}).items():
            if new_key != old_key and old_key in ws.files:
                removed.append(old_key)
        written = save_documents(project, ws, bumped_e, bumped_d, removed)
        saved_ws = load_workspace(project)
        issues = check(project, saved_ws, inv(), {d.id for d in bumped_d} or None)
        return {"saved": written, "issues": _issues(issues), "workspace": saved_ws.docs()}

    @app.delete("/api/displays/{display_id}")
    def delete_display(display_id: str):
        ws = load_workspace(project)
        if display_id not in ws.displays:
            raise HTTPException(404, "no such display")
        save_documents(project, ws, [], [], ["display:" + display_id])
        return {"deleted": display_id, "note": "Run Generate with 'delete orphans' to remove its generated files; your component and hooks are moved to .ui-forge/retired."}

    @app.delete("/api/entities/{name}")
    def delete_entity(name: str):
        ws = load_workspace(project)
        if name not in ws.entities:
            raise HTTPException(404, "no such entity")
        users = sorted(d.id for d in ws.displays.values() if name in d.entities())
        children = sorted(e.name for e in ws.entities.values() if e.parent and e.parent.entity == name)
        if users or children:
            raise HTTPException(409, "still used by " + ", ".join(users + [f"entity {c}" for c in children]))
        save_documents(project, ws, [], [], ["entity:" + name])
        return {"deleted": name, "note": "Run Generate with 'delete orphans' to remove its generated files (your hooks file is moved to .ui-forge/retired). Records already stored stay."}

    # ------------------------------------------------------------------ generation
    @app.post("/api/plan")
    def make_plan(body: dict[str, Any] | None = None):
        body = body or {}
        ws = load_workspace(project)
        issues = check(project, ws, inv())
        if has_errors(issues):
            return {"blocked": True, "issues": _issues(issues)}
        pl = plan(project, ws, prune=bool(body.get("prune")), overrides=body.get("overrides") or None)
        return {"blocked": False, "issues": _issues(issues), "plan": pl.as_dict()}

    @app.post("/api/apply")
    def make_apply(body: dict[str, Any]):
        ws = load_workspace(project)
        issues = check(project, ws, inv())
        if has_errors(issues):
            raise HTTPException(400, "fix the schema errors first")
        try:
            res, pl = apply(project, ws, body.get("hash", ""), set(body.get("force") or []), bool(body.get("prune")),
                            overrides=body.get("overrides") or None)
        except StalePlan as e:
            raise HTTPException(409, str(e)) from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        inv(refresh=True)
        return {"result": res.as_dict(), "plan": pl.as_dict()}

    @app.post("/api/stage")
    def make_stage(body: dict[str, Any]):
        """Writes one display's code to <app>/ui-forge-out/<display-id>/ with a README (nothing goes into the project)."""
        ws = load_workspace(project)
        did = body.get("displayId") or ""
        issues = [i for i in check(project, ws, inv(), {did}) if i.level == "error"]
        if issues:
            raise HTTPException(400, "fix the errors first: " + "; ".join(i.message for i in issues[:5]))
        try:
            res = stage(project, ws, did, overrides=body.get("overrides") or None)
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return res.as_dict()

    @app.get("/api/package")
    def package():
        ws = load_workspace(project)
        files, _ = desired_files(project, ws)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files:
                if f.root == "mirror":
                    continue
                z.writestr(f"{f.root}/{f.path}", f.content)
            for rel in sorted(ws.files.values()):
                z.write(project.app_root / rel, f"app/{rel}")
            z.writestr("README.txt", "UI Forge output package.\napp/ = the React app root, api/ = the backend root.\n"
                                     "Generated files are rewritten on every generation; developer files (hooks, components) only when missing.\n")
        return Response(buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{project.app_id}-ui-forge.zip"'})

    # ------------------------------------------------------------------ application: sign-in, proxy, register, checks
    @app.post("/api/session")
    def session(body: dict[str, Any]):
        try:
            tok = checks.sign_in(project, str(body.get("user", "")), str(body.get("password", "")))
        except PermissionError as e:
            raise HTTPException(401, str(e)) from e
        except httpx.HTTPError as e:
            raise HTTPException(502, f"the application API is not reachable at {project.app_api_url}: {e}") from e
        return {"token": tok}

    @app.api_route("/app-api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def app_api(path: str, request: Request):
        """Forwards to the application API (live preview data)."""
        url = project.app_api_url.rstrip("/") + "/" + path
        headers = {"Content-Type": "application/json"}
        if app_token(request):
            headers["Authorization"] = f"Bearer {app_token(request)}"
        body = await request.body()
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.request(request.method, url, params=dict(request.query_params), content=body or None, headers=headers)
            except httpx.HTTPError as e:
                return JSONResponse({"success": False, "message": f"The application API is not reachable ({e})"}, status_code=502)
        return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type", "application/json"))

    @app.post("/api/register")
    def do_register(request: Request, body: dict[str, Any] | None = None):
        tok = app_token(request)
        if not tok:
            raise HTTPException(401, "sign in to the application first")
        try:
            return {"results": checks.register(project, tok, bool((body or {}).get("dryRun")))}
        except httpx.HTTPError as e:
            raise HTTPException(502, f"the display registry is not reachable at {project.registry_url}: {e}") from e

    @app.get("/api/checklist")
    def checklist(request: Request):
        ws = load_workspace(project)
        return {"items": checks.checklist(project, ws, inv(), app_token(request))}

    @app.post("/api/test/{kind}")
    def run_test(kind: str):
        if kind == "build":
            return checks.run_build(project)
        if kind == "api":
            return checks.run_backend_tests(project)
        raise HTTPException(404, "kind is build or api")

    @app.get("/api/infer")
    def infer(request: Request, endpoint: str):
        if not endpoint.startswith("/") or ".." in endpoint:
            raise HTTPException(400, "endpoint must be an API path")
        tok = app_token(request)
        try:
            r = httpx.get(project.app_api_url.rstrip("/") + endpoint, headers={"Authorization": f"Bearer {tok}"} if tok else {},
                          params={"start": 0, "limit": 50}, timeout=15)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"the application API is not reachable: {e}") from e
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"GET {endpoint} answered {r.status_code}: {r.text[:200]}")
        body = r.json()
        rows = body.get("data", body) if isinstance(body, dict) else body
        if isinstance(rows, dict):
            rows = [rows]
        if not isinstance(rows, list) or not all(isinstance(x, dict) for x in rows):
            raise HTTPException(422, "the endpoint did not return a list of records")
        return {"count": len(rows), "fields": infer_fields(rows)}

    @app.post("/api/parse")
    def parse_doc(body: dict[str, Any]):
        """Validates one raw document (the schema editor's live check)."""
        from pydantic import ValidationError

        from .workspace import pydantic_issues
        doc = body.get("doc") or {}
        try:
            (parse_entity if doc.get("kind") == "entity" else parse_display)(doc)
            return {"issues": []}
        except ValidationError as e:
            return {"issues": _issues(pydantic_issues(doc.get("kind", "?"), e))}
        except ValueError as e:
            return {"issues": [{"level": "error", "where": "document", "path": "schemaVersion", "message": str(e)}]}

    @app.post("/api/ts-literal")
    def ts_literal(body: dict[str, Any]):
        return {"text": ts(body.get("value"))}

    # ------------------------------------------------------------------ the SPA
    @app.get("/{path:path}")
    def spa(path: str):
        if path.startswith(("api/", "app-api/")):
            raise HTTPException(404)
        f = (STATIC / path).resolve()
        if path and f.is_file() and STATIC.resolve() in f.parents:
            return FileResponse(f)
        index = STATIC / "index.html"
        if not index.is_file():
            return Response("<h1>UI Forge</h1><p>The builder is not built: run <code>npm install &amp;&amp; npm run build</code> in ui-forge-web.</p>",
                            media_type="text/html")
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


def run(project: Project, host: str = "127.0.0.1", port: int = 8140, open_browser: bool = False) -> None:
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if host not in ("127.0.0.1", "localhost", "::1") and not os.environ.get("UI_FORGE_TOKEN"):
        raise SystemExit("Refusing to listen on a network address without UI_FORGE_TOKEN: the builder writes files.")
    print(f"UI Forge {__version__}: http://{host}:{port}/   app={project.app_root}  api={project.api_root or '-'}  mirror={project.mirror_root or '-'}")
    if open_browser:
        import threading
        import webbrowser
        threading.Timer(1.2, lambda: webbrowser.open(f"http://{host}:{port}/")).start()
    uvicorn.run(create_app(project), host=host, port=port, log_level="warning")


__all__ = ["create_app", "run", "json"]
