"""Display registry: manifest validation, idempotent registration, permission-filtered navigation, overrides."""

from __future__ import annotations

import copy
import time

import httpx
import jwt
import pytest

from display_registry.app import create_app
from display_registry.manifest import ModuleManifest
from display_registry.security import parse_catalog
from display_registry.settings import RegistrySettings

pytestmark = pytest.mark.anyio

SECRET = "test-secret-for-display-registry-0123456789"
CATALOG = ["dashboard.view", "reference.view", "reference.edit", "reference.delete", "displays.register", "contracts.view"]

CORE = {
    "schemaVersion": 1, "app": "demo",
    "module": {"id": "demo.core", "version": "1.0.0", "title": "Core"},
    "displays": [
        {"id": "dashboard", "title": "Dashboard", "type": "custom", "key": "ExtScreen", "config": {"xtype": "gt-dashboard"},
         "requiredPermissions": ["dashboard.view"]},
        {"id": "contracts.entry", "title": "Contract", "type": "custom", "key": "ExtScreen",
         "params": [{"name": "id", "required": True}], "requiredPermissions": ["contracts.view"]},
    ],
    "menus": [
        {"id": "dashboard", "title": "Dashboard", "display": "dashboard", "sortOrder": 10},
        {"id": "reference", "title": "Reference Data", "sortOrder": 40},
        {"id": "contracts", "title": "Contracts", "sortOrder": 20},
        {"id": "contracts.new", "title": "New Contract", "parent": "contracts", "display": "contracts.entry", "params": {"id": "new"}},
    ],
}
REFERENCE = {
    "schemaVersion": 1, "app": "demo",
    "module": {"id": "demo.reference", "version": "1.0.0"},
    "displays": [
        {"id": "reference.counterparties.summary", "title": "Counterparties", "type": "summary", "key": "CounterpartySummary",
         "requiredPermissions": ["reference.view"],
         "actionPermissions": {"create": "reference.edit", "delete": "reference.delete"}},
    ],
    "menus": [
        {"id": "reference.counterparties", "title": "Counterparties", "parent": "reference",
         "display": "reference.counterparties.summary", "sortOrder": 10},
    ],
}


def token(user: str, perms: list[str], **extra) -> str:
    claims = {"sub": user, "permissions": perms, "iss": "demo", "aud": "demo-app", "exp": int(time.time()) + 600}
    claims.update(extra)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def bearer(user: str, perms: list[str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {token(user, perms)}"}


ADMIN = ["dashboard.view", "reference.view", "reference.edit", "reference.delete", "displays.register", "contracts.view"]
READER = ["dashboard.view", "reference.view"]


@pytest.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DEMO_JWT_SECRET", SECRET)
    apps = ('{"demo": {"title": "Demo", "issuer": "demo", "audience": "demo-app", "secretEnv": "DEMO_JWT_SECRET",'
            ' "permissionCatalogUrl": "http://catalog.test/api/permissions"}}')
    settings = RegistrySettings(_env_file=None, database_url=f"sqlite+aiosqlite:///{tmp_path}/reg.db", apps_json=apps)
    app = create_app(settings)

    async def fake_get(self, app_id, cfg, principal):
        return set(CATALOG)

    monkeypatch.setattr("display_registry.security.CatalogCache.get", fake_get)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://reg") as c:
            yield c


async def register(c, manifest, user="admin", perms=ADMIN, **opts):
    return await c.post("/api/v1/apps/demo/modules/register", json={"manifest": manifest, **opts}, headers=bearer(user, perms))


def test_manifest_rejects_bad_ids_duplicates_and_cycles():
    bad = copy.deepcopy(CORE)
    bad["displays"][0]["id"] = "Bad Id"
    with pytest.raises(ValueError):
        ModuleManifest.model_validate(bad)
    dup = copy.deepcopy(CORE)
    dup["menus"].append(dict(dup["menus"][0]))
    with pytest.raises(ValueError, match="duplicate menu id"):
        ModuleManifest.model_validate(dup)
    cyc = copy.deepcopy(CORE)
    cyc["menus"] += [{"id": "a", "title": "A", "parent": "b"}, {"id": "b", "title": "B", "parent": "a"}]
    with pytest.raises(ValueError, match="cycle"):
        ModuleManifest.model_validate(cyc)


def test_catalog_formats():
    assert parse_catalog(["a.view"]) == {"a.view"}
    assert parse_catalog({"data": [{"module": "trades", "actions": ["view", "edit"]}]}) == {"trades.view", "trades.edit"}
    assert parse_catalog({"permissions": [{"name": "x"}]}) == {"x"}


async def test_auth_required_and_checked(client):
    assert (await client.get("/api/v1/apps/demo/navigation")).status_code == 401
    bad = jwt.encode({"sub": "x", "iss": "demo", "aud": "demo-app", "exp": int(time.time()) + 60}, "wrong-secret-0123456789012345678901", algorithm="HS256")
    assert (await client.get("/api/v1/apps/demo/navigation", headers={"Authorization": f"Bearer {bad}"})).status_code == 401
    expired = token("x", [], exp=int(time.time()) - 5)
    r = await client.get("/api/v1/apps/demo/navigation", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and "expired" in r.json()["message"]
    assert (await client.get("/api/v1/apps/nope/navigation", headers=bearer("x", []))).status_code == 404
    r = await register(client, CORE, user="reader", perms=READER)
    assert r.status_code == 403


async def test_register_is_idempotent_and_reports_changes(client):
    r = await register(client, CORE)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "created"
    assert {(c["kind"], c["id"]) for c in body["changes"]} >= {("module", "demo.core"), ("display", "dashboard"), ("menu", "contracts.new")}
    again = (await register(client, CORE)).json()
    assert again["status"] == "unchanged" and again["changes"] == []
    changed = copy.deepcopy(CORE)
    changed["module"]["version"] = "1.1.0"
    changed["menus"][0]["title"] = "Home"
    upd = (await register(client, changed)).json()
    assert upd["status"] == "updated"
    assert {"kind": "menu", "id": "dashboard", "change": "updated", "fields": ["title"]} in upd["changes"]
    older = copy.deepcopy(CORE)
    r = await register(client, older)
    assert r.status_code == 422 and "older" in r.json()["errors"][0]
    status = (await client.get("/api/v1/apps/demo/modules/demo.core", headers=bearer("admin", ADMIN))).json()
    assert status["version"] == "1.1.0" and len(status["history"]) == 2


async def test_validation_errors(client):
    await register(client, CORE)
    bad = copy.deepcopy(REFERENCE)
    bad["displays"][0]["requiredPermissions"] = ["reference.fly"]
    bad["displays"][0]["type"] = "kanban"
    bad["menus"][0]["parent"] = "missing"
    bad["menus"].append({"id": "dashboard", "title": "Mine now", "display": "reference.counterparties.summary"})
    r = await client.post("/api/v1/apps/demo/modules/validate", json={"manifest": bad}, headers=bearer("admin", ADMIN))
    errors = " | ".join(r.json()["errors"])
    assert r.json()["valid"] is False
    for text in ("permission 'reference.fly' does not exist", "type 'kanban'", "parent 'missing' is not registered",
                 "menu 'dashboard' belongs to module 'demo.core'"):
        assert text in errors
    needs_param = copy.deepcopy(REFERENCE)
    needs_param["menus"].append({"id": "reference.contract", "title": "C", "parent": "reference", "display": "contracts.entry"})
    r = await client.post("/api/v1/apps/demo/modules/validate", json={"manifest": needs_param}, headers=bearer("admin", ADMIN))
    assert "needs parameter(s) id" in " ".join(r.json()["errors"])
    r = await register(client, {"app": "demo", "module": {"id": "x", "version": "1"}})
    assert r.status_code == 422 and "semantic" in " ".join(r.json()["errors"])


async def test_navigation_filters_by_permission_and_prunes_empty_folders(client):
    await register(client, CORE)
    assert (await register(client, REFERENCE)).json()["status"] == "created"
    nav = (await client.get("/api/v1/apps/demo/navigation", headers=bearer("reader", READER))).json()
    ids = [m["id"] for m in nav["menu"]]
    assert ids == ["dashboard", "reference"]  # contracts folder hidden: its only entry needs contracts.view
    assert nav["menu"][1]["children"][0]["display"] == "reference.counterparties.summary"
    meta = nav["displays"]["reference.counterparties.summary"]
    assert meta["actions"] == {"create": False, "delete": False} and meta["key"] == "CounterpartySummary"
    full = (await client.get("/api/v1/apps/demo/navigation", headers=bearer("admin", ADMIN))).json()
    assert [m["id"] for m in full["menu"]] == ["dashboard", "contracts", "reference"]
    assert full["displays"]["reference.counterparties.summary"]["actions"] == {"create": True, "delete": True}
    r = await client.get("/api/v1/apps/demo/displays/contracts.entry", headers=bearer("reader", READER))
    assert r.status_code == 403
    r = await client.get("/api/v1/apps/demo/displays/nope", headers=bearer("reader", READER))
    assert r.status_code == 404


async def test_admin_overrides_survive_registration_and_prune_disables(client):
    await register(client, CORE)
    await register(client, REFERENCE)
    h = bearer("admin", ADMIN)
    r = await client.patch("/api/v1/apps/demo/menus/reference.counterparties", json={"enabled": False}, headers=h)
    assert r.status_code == 200 and r.json()["adminOverrides"] == {"enabled": False}
    r = await client.patch("/api/v1/apps/demo/displays/dashboard", json={"requiredPermissions": ["nope.view"]}, headers=h)
    assert r.status_code == 422
    newer = copy.deepcopy(REFERENCE)
    newer["module"]["version"] = "1.0.1"
    newer["menus"][0]["sortOrder"] = 5
    rep = (await register(client, newer)).json()
    assert {"kind": "menu", "id": "reference.counterparties", "change": "kept-admin-override", "fields": ["enabled"]} in rep["changes"]
    nav = (await client.get("/api/v1/apps/demo/navigation", headers=h)).json()
    assert "reference" not in [m["id"] for m in nav["menu"]]  # disabled by admin, folder now empty
    newer["module"]["version"] = "1.0.2"
    rep = (await register(client, newer, overrideAdminChanges=True)).json()
    nav = (await client.get("/api/v1/apps/demo/navigation", headers=h)).json()
    assert "reference" in [m["id"] for m in nav["menu"]]
    pruned = copy.deepcopy(CORE)
    pruned["module"]["version"] = "2.0.0"
    pruned["menus"] = [m for m in pruned["menus"] if m["id"] != "contracts.new"]
    rep = (await register(client, pruned, prune=True)).json()
    assert {"kind": "menu", "id": "contracts.new", "change": "disabled"} in rep["changes"]
    dry = copy.deepcopy(pruned)
    dry["module"]["version"] = "2.0.1"
    dry["menus"][0]["title"] = "Dry"
    rep = (await register(client, dry, dryRun=True)).json()
    assert rep["dryRun"] and rep["status"] == "updated"
    status = (await client.get("/api/v1/apps/demo/modules/demo.core", headers=h)).json()
    assert status["version"] == "2.0.0"


async def test_schema_endpoint(client):
    s = (await client.get("/api/v1/schema/module-manifest")).json()
    assert s["title"].startswith("Module registration manifest") and "displays" in s["properties"]
