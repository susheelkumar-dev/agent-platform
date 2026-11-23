"""UI Forge: schema validation, semantic checks, deterministic generation and safe regeneration.

Every test builds a small framework-shell app (and a GridTrade-style API root) in a temporary folder, imports
the shipped example and works on it, so nothing here touches a real project.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ui_forge.gen_frontend import IMPORT_BEGIN, REG_BEGIN, wire_displays_ts
from ui_forge.plan import LOCK_FILE, StalePlan, apply, plan
from ui_forge.project import inspect, load_project
from ui_forge.schema import SCHEMA_VERSION, migrate, parse_display, parse_entity
from ui_forge.semantic import check, has_errors
from ui_forge.service import create_app
from ui_forge.workspace import load_workspace, overlay, save_documents

EXAMPLE = Path(__file__).resolve().parents[2] / "src" / "ui_forge" / "examples" / "gridtrade-assets.json"

DISPLAYS_TS = """import { builtinDisplays, defineDisplays, mergeDisplays } from '@extreact/framework';

export const displays = mergeDisplays(
  builtinDisplays,
  defineDisplays({
    Legacy: { load: async () => ({ default: () => null }), types: ['custom'] },
  })
);
"""

SECURITY_JS = """'use strict';
const BASE_MODULES = [
  { module: 'dashboard', label: 'Dashboard', actions: ['view'] },
  { module: 'reference', label: 'Reference Data', actions: ['view', 'edit', 'delete'] },
];
"""

SERVER_JS = """'use strict';
const STATIC_LOOKUPS = {
  regions: ['North', 'South'],
  counterparties: [],
};
route('GET', '/api/contracts', () => []);
if (security.generated) security.generated.register({});
"""

MANIFEST = {
    "app": "demo", "module": {"id": "demo.core", "version": "1.0.0"},
    "displays": [{"id": "contracts.summary", "title": "Contracts", "type": "summary", "key": "ContractSummary", "route": "contracts"}],
    "menus": [{"id": "trading", "title": "Trading"}, {"id": "contracts.summary", "title": "Contracts", "parent": "trading", "display": "contracts.summary"}],
}


@pytest.fixture()
def roots(tmp_path: Path):
    app = tmp_path / "app"
    (app / "src" / "framework").mkdir(parents=True)
    (app / "src" / "framework" / "index.ts").write_text("export {};\n", encoding="utf-8")
    (app / "src" / "displays.ts").write_text(DISPLAYS_TS, encoding="utf-8")
    (app / "src" / "app.config.ts").write_text("export const appConfig = { appId: 'demo', apiBase: '/api' };\n", encoding="utf-8")
    (app / "registration").mkdir()
    (app / "registration" / "demo.core.manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
    api = tmp_path / "api"
    (api / "server").mkdir(parents=True)
    (api / "server" / "server.js").write_text(SERVER_JS, encoding="utf-8")
    (api / "server" / "security.js").write_text(SECURITY_JS, encoding="utf-8")
    mirror = tmp_path / "mirror"
    mirror.mkdir()
    return app, api, mirror


@pytest.fixture()
def project(roots):
    app, api, mirror = roots
    return load_project(app, api, mirror)


def import_example(project):
    doc = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    ws = load_workspace(project)
    new_ws, shape = overlay(ws, doc["entities"], doc["displays"])
    assert shape == []
    save_documents(project, ws, list(new_ws.entities.values()), list(new_ws.displays.values()))
    return load_workspace(project)


def generate(project, prune=False, force=()):
    ws = load_workspace(project)
    pl = plan(project, ws, prune=prune)
    res, _ = apply(project, ws, pl.hash, set(force), prune)
    return res


# ------------------------------------------------------------------------------------------------ schema
def test_example_is_valid_and_consistent(project):
    ws = import_example(project)
    assert set(ws.displays) == {"assets.generation-assets", "assets.generation-asset", "assets.asset-outages"}
    issues = check(project, ws, inspect(project))
    assert not has_errors(issues), [i.as_dict() for i in issues if i.level == "error"]


def test_schema_rejects_bad_documents():
    with pytest.raises(ValidationError):
        parse_entity({"schemaVersion": SCHEMA_VERSION, "kind": "entity", "name": "X", "label": "X", "plural": "Xs", "module": "m",
                      "endpoint": "/x", "fields": [], "permissions": {"view": "a.view", "create": "a.edit", "update": "a.edit", "delete": "a.delete"}})
    with pytest.raises(ValidationError):  # unknown property (strict documents catch typos)
        parse_display({"schemaVersion": SCHEMA_VERSION, "kind": "display", "id": "m.x", "name": "XSummary", "title": "X", "type": "summary",
                       "module": "m", "entity": "X", "summary": {"columns": [{"field": "a"}]}, "colour": "red"})
    with pytest.raises(ValueError):
        migrate({"schemaVersion": "9.0", "kind": "display"})


def test_semantic_checks_catch_conflicts_and_unknown_permissions(project):
    import_example(project)
    ws = load_workspace(project)
    d = ws.displays["assets.generation-assets"].model_dump(mode="json", exclude_none=True)
    d["route"] = "contracts"                       # taken by an existing display
    d["menu"]["parent"] = "no-such-folder"
    d["permissions"] = {"required": ["nope.view"]}
    new_ws, shape = overlay(ws, [], [d])
    assert shape == []
    msgs = " | ".join(i.message for i in check(project, new_ws, inspect(project)) if i.level == "error")
    assert "contracts" in msgs
    assert "no-such-folder" in msgs
    assert "nope.view" in msgs


def test_display_id_conflict_with_existing_app(project):
    import_example(project)
    ws = load_workspace(project)
    d = ws.displays["assets.generation-assets"].model_dump(mode="json", exclude_none=True)
    d["id"] = "contracts.summary"
    d["menu"]["id"] = "contracts.summary"
    new_ws, _ = overlay(ws, [], [d], {"display:contracts.summary": "display:assets.generation-assets"})
    errs = [i for i in check(project, new_ws, inspect(project)) if i.level == "error"]
    assert any("contracts.summary" in i.message for i in errs)


# ------------------------------------------------------------------------------------------------ generation
def test_generation_is_deterministic(project):
    ws = import_example(project)
    a = plan(project, ws)
    b = plan(project, load_workspace(project))
    assert a.hash == b.hash
    assert {c.key: c.content for c in a.changes} == {c.key: c.content for c in b.changes}


def test_apply_writes_wires_displays_ts_and_mirror(project):
    import_example(project)
    res = generate(project)
    app, mirror = project.app_root, project.mirror_root
    assert res.written and not res.skipped
    text = (app / "src" / "displays.ts").read_text(encoding="utf-8")
    assert IMPORT_BEGIN in text and REG_BEGIN in text and "generatedDisplays" in text
    assert (app / "src" / "modules" / "generated-displays.ts").is_file()
    assert (mirror / "src" / "modules" / "generated-displays.ts").is_file()
    assert (project.api_root / "server" / "generated" / "index.js").is_file()
    manifest = json.loads((app / "registration" / "demo.ui-forge.assets.manifest.json").read_text(encoding="utf-8"))
    assert {d["id"] for d in manifest["displays"]} == {"assets.generation-assets", "assets.generation-asset", "assets.asset-outages"}
    lock = json.loads((app / LOCK_FILE).read_text(encoding="utf-8"))
    assert lock["files"] and lock["developer"]
    # a second run changes nothing
    pl = plan(project, load_workspace(project))
    assert set(pl.counts()) <= {"unchanged", "keep"}


def test_wire_displays_ts_is_idempotent():
    once, problem = wire_displays_ts(DISPLAYS_TS)
    assert problem is None
    twice, _ = wire_displays_ts(once)
    assert once == twice
    _, problem = wire_displays_ts("import x from 'y';\nexport const displays = {};\n")
    assert problem and "mergeDisplays" in problem


def test_developer_files_are_never_overwritten(project):
    import_example(project)
    generate(project)
    hooks = next((project.app_root / "src" / "modules" / "assets" / "displays").rglob("*.hooks.ts"))
    hooks.write_text("// my business rules\n", encoding="utf-8")
    ws = load_workspace(project)
    e = ws.entities["GenerationAsset"].model_dump(mode="json", exclude_none=True)
    e["label"] = "Plant"  # a schema change regenerates generated files only
    new_ws, _ = overlay(ws, [e], [])
    save_documents(project, ws, [new_ws.entities["GenerationAsset"]], [])
    res = generate(project)
    assert res.written
    assert hooks.read_text(encoding="utf-8") == "// my business rules\n"


def test_hand_edited_generated_file_is_a_conflict_with_backup_on_force(project):
    import_example(project)
    generate(project)
    cfg = next((project.app_root / "src" / "modules" / "assets" / "displays").rglob("*.config.generated.ts"))
    cfg.write_text(cfg.read_text(encoding="utf-8") + "\n// edited\n", encoding="utf-8")
    ws = load_workspace(project)
    e = ws.entities["GenerationAsset"].model_dump(mode="json", exclude_none=True)
    e["plural"] = "Plants"
    new_ws, _ = overlay(ws, [e], [])
    save_documents(project, ws, [new_ws.entities["GenerationAsset"]], [])
    pl = plan(project, load_workspace(project))
    key = "app:" + cfg.relative_to(project.app_root).as_posix()
    assert next(c for c in pl.changes if c.key == key).status == "conflict"
    res = generate(project)
    assert key in res.skipped and "// edited" in cfg.read_text(encoding="utf-8")
    res = generate(project, force=[key])
    assert key in res.written and res.backups
    assert "// edited" not in cfg.read_text(encoding="utf-8")
    assert "// edited" in (project.app_root / res.backups[0]).read_text(encoding="utf-8")


def test_stale_plan_is_refused(project):
    ws = import_example(project)
    pl = plan(project, ws)
    (project.app_root / "src" / "displays.ts").write_text(DISPLAYS_TS + "\n// changed\n", encoding="utf-8")
    with pytest.raises(StalePlan):
        apply(project, load_workspace(project), pl.hash)


def test_deleting_a_display_prunes_generated_and_retires_developer_files(project):
    import_example(project)
    generate(project)
    ws = load_workspace(project)
    save_documents(project, ws, [], [], ["display:assets.asset-outages"])
    pl = plan(project, load_workspace(project), prune=True)
    statuses = {c.key: c.status for c in pl.changes}
    folder = "src/modules/assets/displays/asset-outage-master-slave"
    assert statuses[f"app:{folder}/asset-outage-master-slave.config.generated.ts"] == "orphan"
    assert statuses[f"app:{folder}/AssetOutageMasterSlave.tsx"] == "retire"
    res = generate(project, prune=True)
    assert not (project.app_root / folder).exists()              # nothing left that would break the build
    assert any(r.endswith("AssetOutageMasterSlave.tsx") for r in res.retired)
    assert all((project.app_root / r).is_file() for r in res.retired)  # moved aside, not deleted
    assert set(plan(project, load_workspace(project)).counts()) <= {"unchanged", "keep"}


def test_paths_cannot_escape_the_roots(project):
    from ui_forge.plan import _target
    with pytest.raises(ValueError):
        _target(project, "app", "../outside.txt")


def test_generated_backend_enforces_permissions(project):
    import_example(project)
    generate(project)
    routes = (project.api_root / "server" / "generated" / "generation-asset.routes.generated.js").read_text(encoding="utf-8")
    for perm in ("assets.view", "assets.edit", "assets.delete"):
        assert perm in routes
    assert "need(" in routes
    index = (project.api_root / "server" / "generated" / "index.js").read_text(encoding="utf-8")
    assert "permissionModules" in index
    for f in (project.api_root / "server" / "generated").iterdir():  # no secrets or machine paths in generated code
        text = f.read_text(encoding="utf-8")
        assert str(project.app_root) not in text and "password" not in text.lower()


# ------------------------------------------------------------------------------------------------ service
def test_service_preview_save_plan_apply(project, monkeypatch):
    monkeypatch.delenv("UI_FORGE_TOKEN", raising=False)
    import_example(project)
    c = TestClient(create_app(project))
    ws = c.get("/api/workspace").json()
    d = next(x for x in ws["displays"] if x["id"] == "assets.generation-assets")
    d["title"] = "Plants"
    r = c.post("/api/preview", json={"entities": [], "displays": [d], "focus": [d["id"]]}).json()
    assert r["configs"][d["id"]]["entity"] and not [i for i in r["issues"] if i["level"] == "error"]
    assert any(f["path"].endswith("generated-displays.ts") for f in r["files"])
    r = c.post("/api/save", json={"entities": [], "displays": [d]}).json()
    assert r["saved"]
    saved = next(x for x in r["workspace"]["displays"] if x["id"] == d["id"])
    assert saved["title"] == "Plants" and saved["revision"] == 2
    pl = c.post("/api/plan", json={}).json()
    assert not pl["blocked"]
    res = c.post("/api/apply", json={"hash": pl["plan"]["hash"], "force": []}).json()
    assert res["result"]["written"]
    assert c.post("/api/apply", json={"hash": "stale", "force": []}).status_code == 409
    assert c.delete("/api/entities/GenerationAsset").status_code == 409   # still used


def test_service_token_guard(project, monkeypatch):
    monkeypatch.setenv("UI_FORGE_TOKEN", "s3cret")
    c = TestClient(create_app(project))
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/project").status_code == 401
    assert c.get("/api/project", headers={"X-UI-Forge-Token": "s3cret"}).status_code == 200


def test_project_requires_a_framework_app(tmp_path):
    with pytest.raises(ValueError):
        load_project(tmp_path)


def test_backend_seam_is_required_for_api_root(roots):
    app, api, _ = roots
    (api / "server" / "server.js").write_text("// no seam\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_project(app, api)
    shutil.rmtree(api)


def test_lock_travels_with_the_mirror(project):
    """A fresh migration copies the mirror (with its lock) into a new app: nothing should look hand-edited."""
    import_example(project)
    generate(project)
    assert (project.mirror_root / LOCK_FILE).read_text(encoding="utf-8") == (project.app_root / LOCK_FILE).read_text(encoding="utf-8")
    (project.app_root / LOCK_FILE).unlink()
    pl = plan(project, load_workspace(project))
    assert set(pl.counts()) <= {"unchanged", "keep"}


def test_plural_is_idempotent():
    from ui_forge.naming import plural
    assert [plural(w) for w in ("Item", "Items", "Entity", "Status", "Analysis")] == ["Items", "Items", "Entities", "Statuses", "Analyses"]


def test_app_with_the_framework_as_a_package(tmp_path):
    """Current migrations depend on the @extreact/framework package instead of copying it into src/framework."""
    app = tmp_path / "app"
    (app / "src").mkdir(parents=True)
    (app / "src" / "displays.ts").write_text(DISPLAYS_TS, encoding="utf-8")
    with pytest.raises(ValueError):
        load_project(app)
    (app / "package.json").write_text(json.dumps({"dependencies": {"@extreact/framework": "file:../x.tgz"}}), encoding="utf-8")
    assert load_project(app).app_root == app.resolve()


def _snapshot(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8") for p in root.rglob("*")
            if p.is_file() and "ui-forge-out" not in p.parts}


def test_stage_writes_a_review_folder_and_never_the_project(project):
    from ui_forge.stage import stage
    import_example(project)
    before_app, before_api = _snapshot(project.app_root), _snapshot(project.api_root)
    res = stage(project, load_workspace(project), "assets.asset-outages")
    assert _snapshot(project.app_root) == before_app and _snapshot(project.api_root) == before_api
    folder = project.app_root / "ui-forge-out" / "assets.asset-outages"
    assert res.folder == folder
    staged = {f"{f.root}/{f.path}" for f in res.files}
    assert "app/src/modules/assets/displays/asset-outage-master-slave/AssetOutageMasterSlave.tsx" in staged
    assert "app/src/modules/assets/displays/asset-outage-master-slave/asset-outage-master-slave.hooks.ts" in staged
    assert "api/server/generated/asset-outage.routes.generated.js" in staged
    assert "app/src/modules/assets/ui-forge/asset-outage-master-slave.display.json" in staged
    assert not any("generation-asset-summary" in s for s in staged)  # only this display's own files
    for f in res.files:
        assert (folder / f.root / f.path).is_file()
    readme = (folder / "README.md").read_text(encoding="utf-8")
    for text in ("assets.asset-outages", "AssetOutageMasterSlave", "#/assets/asset-outages", "assets.view", "Copy-Item",
                 "agentctl display register", "selftest.generated.js", "Apply to project", str(project.mirror_root)):
        assert text in readme, text
    assert "assets.asset-outages" in (project.app_root / "ui-forge-out" / "README.md").read_text(encoding="utf-8")

    # staging again keeps the earlier folder (and any edits made in it)
    (folder / "app" / "note.txt").write_text("my edit", encoding="utf-8")
    res2 = stage(project, load_workspace(project), "assets.asset-outages")
    assert res2.previous is not None and (res2.previous / "app" / "note.txt").read_text(encoding="utf-8") == "my edit"


def test_stage_uses_developer_overrides_and_rejects_unknown_displays(project):
    from ui_forge.stage import stage
    import_example(project)
    key = "app:src/modules/assets/displays/generation-asset-entry/generation-asset-entry.hooks.ts"
    res = stage(project, load_workspace(project), "assets.generation-asset", overrides={key: "// my hooks\n"})
    assert (res.folder / "app" / key[4:]).read_text(encoding="utf-8") == "// my hooks\n"
    with pytest.raises(KeyError):
        stage(project, load_workspace(project), "nope.nope")


def test_service_stage_endpoint(project, monkeypatch):
    monkeypatch.delenv("UI_FORGE_TOKEN", raising=False)
    import_example(project)
    c = TestClient(create_app(project))
    r = c.post("/api/stage", json={"displayId": "assets.generation-assets"})
    assert r.status_code == 200 and "README" not in r.json()["folder"] and "## Put it in the project" in r.json()["readme"]
    assert c.post("/api/stage", json={"displayId": "x.y"}).status_code == 404


# ------------------------------------------------------------------------------------------------ front end only
def test_front_end_only_writes_no_server_code_and_an_api_contract(roots):
    """Without --api the backend can be anything (.NET, Java...): nothing is generated for it; each entity gets an
    API contract the backend team implements, and the Ext JS / API folder is never touched."""
    from ui_forge.stage import stage
    app, api, mirror = roots
    p = load_project(app, None, mirror)
    assert p.backend_kind == "none"
    import_example(p)
    ws = load_workspace(p)
    assert not [i for i in check(p, ws, inspect(p)) if i.level == "error"]
    pl = plan(p, ws)
    assert all(c.root != "api" for c in pl.changes)
    before_api = _snapshot(api)
    apply(p, ws, pl.hash, set(), False)
    assert _snapshot(api) == before_api
    contract = (app / "src" / "modules" / "assets" / "api" / "generation-asset.api.md").read_text(encoding="utf-8")
    for text in ("| GET | `/generation-assets` | `assets.view`", "| POST | `/generation-assets/{id}/retire` |",
                 "`start`, `limit`", "`capacityMwFrom`, `capacityMwTo`", "\"total\"", "`assets.delete`", "403"):
        assert text in contract, text
    assert (mirror / "src" / "modules" / "assets" / "api" / "generation-asset.api.md").is_file()  # kept for the next migration
    readme = (stage(p, load_workspace(p), "assets.generation-assets").folder / "README.md").read_text(encoding="utf-8")
    assert "generation-asset.api.md" in readme and "Copy-Item -Recurse -Force" not in readme.split("4. **API**")[1].split("5.")[0]


def test_switching_to_front_end_only_keeps_the_existing_api_files(project, roots):
    """A project that generated Node API code before, then runs without --api: nothing breaks and nothing in the API
    folder changes (the lock keeps its record of those files)."""
    import_example(project)
    generate(project)
    app, api, mirror = roots
    before_api = _snapshot(api)
    p = load_project(app, None, mirror)
    ws = load_workspace(p)
    pl = plan(p, ws)
    apply(p, ws, pl.hash, set(), False)
    apply(p, ws, plan(p, ws).hash, set(), False)  # a second run with nothing to do
    assert _snapshot(api) == before_api
    lock = json.loads((app / LOCK_FILE).read_text(encoding="utf-8"))
    assert any(k.startswith("api:") for k in lock["files"]) and any(k.startswith("api:") for k in lock["developer"])
