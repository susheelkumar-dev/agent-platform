"""Display registry HTTP service.

    GET   /health
    GET   /api/v1/schema/module-manifest              JSON Schema of the manifest
    GET   /api/v1/apps                                applications this registry serves
    GET   /api/v1/apps/{app}/navigation               the caller's permitted menu tree and display metadata
    GET   /api/v1/apps/{app}/displays/{display}       one display's metadata (403 when not permitted)
    POST  /api/v1/apps/{app}/modules/validate         check a manifest, change nothing
    POST  /api/v1/apps/{app}/modules/register         validate and register (idempotent, transactional)
    GET   /api/v1/apps/{app}/modules                  registered modules
    GET   /api/v1/apps/{app}/modules/{module}         one module: its items and registration history
    PATCH /api/v1/apps/{app}/displays/{display}       admin override (enabled, permissions, title)
    PATCH /api/v1/apps/{app}/menus/{menu}             admin override (enabled, permissions, order, title, parent)
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from . import store
from .manifest import ModuleManifest, manifest_json_schema
from .security import AuthError, CatalogCache, Principal, verify_token
from .settings import AppConfig, RegistrySettings, get_settings
from .tables import RegistryDisplayRow, RegistryHistoryRow, RegistryMenuRow, RegistryModuleRow

logger = logging.getLogger("display_registry")
TABLES = [RegistryModuleRow.__table__, RegistryDisplayRow.__table__, RegistryMenuRow.__table__, RegistryHistoryRow.__table__]


class RegisterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    manifest: dict[str, Any]
    prune: bool = False
    override_admin_changes: bool = Field(default=False, alias="overrideAdminChanges")
    dry_run: bool = Field(default=False, alias="dryRun")


def _manifest(raw: dict[str, Any]) -> ModuleManifest:
    try:
        return ModuleManifest.model_validate(raw)
    except ValidationError as e:
        errors = []
        for err in e.errors():
            loc = ".".join(str(x) for x in err["loc"])
            errors.append(f"{loc}: {err['msg']}" if loc else err["msg"])
        raise HTTPException(422, {"message": "The manifest is not valid", "errors": errors})


def create_app(settings: RegistrySettings | None = None) -> FastAPI:
    settings = settings or get_settings()
    apps: dict[str, AppConfig] = settings.apps()
    kwargs: dict = {"pool_pre_ping": True}
    if settings.database_url.startswith("sqlite"):
        from pathlib import Path
        path = settings.database_url.split("///", 1)[-1]
        if path and path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_async_engine(settings.database_url, **kwargs)
    sessions = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    catalog = CatalogCache(settings.catalog_cache_seconds, settings.http_timeout_seconds)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if settings.auto_create_schema:
            async with engine.begin() as conn:
                if settings.database_url.startswith("sqlite"):
                    await conn.execute(text("PRAGMA journal_mode=WAL"))
                from ai_storage.tables import Base
                await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        if not apps:
            logger.warning("no applications configured: set DISPLAY_REGISTRY_APPS or DISPLAY_REGISTRY_APPS_FILE")
        yield
        await engine.dispose()

    app = FastAPI(title="Display Registry", version="1.0.0", lifespan=lifespan,
                  description="Database-backed menus and display registration for front-end applications.")
    app.state.engine, app.state.sessions, app.state.catalog, app.state.apps = engine, sessions, catalog, apps
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                           allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def correlation(request: Request, call_next):
        cid = request.headers.get("x-correlation-id") or request.headers.get("x-request-id") or uuid.uuid4().hex
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Correlation-Id"] = cid
        logger.info("%s %s -> %s in %.0fms [%s]", request.method, request.url.path, response.status_code,
                    (time.perf_counter() - started) * 1000, cid)
        return response

    @app.exception_handler(AuthError)
    async def _auth(_: Request, exc: AuthError):
        return JSONResponse({"message": exc.message}, status_code=exc.status)

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException):
        body = exc.detail if isinstance(exc.detail, dict) else {"message": exc.detail}
        return JSONResponse(body, status_code=exc.status_code)

    def app_cfg(app_id: str) -> AppConfig:
        cfg = apps.get(app_id)
        if cfg is None:
            raise HTTPException(404, f"Unknown application '{app_id}'")
        return cfg

    def auth(app_id: str, authorization: str | None, *perms: str) -> tuple[AppConfig, Principal]:
        cfg = app_cfg(app_id)
        principal = verify_token(cfg, authorization)
        missing = [p for p in perms if p not in principal.permissions]
        if missing:
            raise HTTPException(403, f"{principal.user} needs permission {', '.join(missing)}")
        return cfg, principal

    @app.get("/health")
    async def health():
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok", "apps": sorted(apps)}

    @app.get("/api/v1/schema/module-manifest")
    async def schema():
        return manifest_json_schema()

    @app.get("/api/v1/apps")
    async def list_apps():
        return [{"id": k, "title": v.title, "displayTypes": v.display_types} for k, v in sorted(apps.items())]

    @app.get("/api/v1/apps/{app_id}/navigation")
    async def nav(app_id: str, authorization: str | None = Header(default=None)):
        _, principal = auth(app_id, authorization)
        async with sessions() as s:
            return await store.navigation(s, app_id, principal)

    @app.get("/api/v1/apps/{app_id}/displays/{display_id}")
    async def display(app_id: str, display_id: str, authorization: str | None = Header(default=None)):
        _, principal = auth(app_id, authorization)
        async with sessions() as s:
            row = await s.get(RegistryDisplayRow, (app_id, display_id))
        if row is None or not row.enabled:
            raise HTTPException(404, f"Display '{display_id}' is not registered")
        if not all(p in principal.permissions for p in row.required_permissions):
            raise HTTPException(403, f"{principal.user} may not open '{row.title}'")
        return store.display_payload(row, principal)

    @app.post("/api/v1/apps/{app_id}/modules/validate")
    async def validate(app_id: str, body: RegisterRequest, authorization: str | None = Header(default=None)):
        cfg = app_cfg(app_id)
        cfg, principal = auth(app_id, authorization, cfg.register_permission)
        manifest = _manifest(body.manifest)
        perms = await catalog.get(app_id, cfg, principal)
        async with sessions() as s:
            rep = await store.validate(s, app_id, cfg, manifest, perms, prune=body.prune)
        out = rep.as_dict()
        out["valid"] = not rep.errors
        return out

    @app.post("/api/v1/apps/{app_id}/modules/register")
    async def register(app_id: str, body: RegisterRequest, authorization: str | None = Header(default=None)):
        cfg = app_cfg(app_id)
        cfg, principal = auth(app_id, authorization, cfg.register_permission)
        manifest = _manifest(body.manifest)
        perms = await catalog.get(app_id, cfg, principal)
        async with sessions() as s:
            rep = await store.register(s, app_id, cfg, manifest, perms, principal.user, prune=body.prune,
                                       override_admin=body.override_admin_changes, dry_run=body.dry_run)
        return JSONResponse(rep.as_dict(), status_code=422 if rep.errors else 200)

    @app.get("/api/v1/apps/{app_id}/modules")
    async def modules(app_id: str, authorization: str | None = Header(default=None)):
        cfg = app_cfg(app_id)
        auth(app_id, authorization, cfg.register_permission)
        async with sessions() as s:
            rows = (await s.scalars(select(RegistryModuleRow).where(RegistryModuleRow.app_id == app_id))).all()
        return [{"module": r.module_id, "version": r.version, "title": r.title, "updatedAt": r.updated_at.isoformat()} for r in rows]

    @app.get("/api/v1/apps/{app_id}/modules/{module_id}")
    async def module(app_id: str, module_id: str, authorization: str | None = Header(default=None)):
        cfg = app_cfg(app_id)
        auth(app_id, authorization, cfg.register_permission)
        async with sessions() as s:
            out = await store.module_status(s, app_id, module_id)
        if out is None:
            raise HTTPException(404, f"Module '{module_id}' is not registered")
        return out

    async def patch(app_id: str, kind: str, item_id: str, body: dict[str, Any], authorization: str | None):
        cfg = app_cfg(app_id)
        cfg, principal = auth(app_id, authorization, cfg.admin_permission)
        names = {"requiredPermissions": "required_permissions", "actionPermissions": "action_permissions",
                 "sortOrder": "sort_order", "parent": "parent_id"}
        changes = {names.get(k, k): v for k, v in body.items()}
        perms = await catalog.get(app_id, cfg, principal)
        async with sessions() as s:
            try:
                return await store.admin_patch(s, app_id, kind, item_id, changes, principal.user, perms)
            except LookupError as e:
                raise HTTPException(404, str(e))
            except ValueError as e:
                raise HTTPException(422, str(e))

    @app.patch("/api/v1/apps/{app_id}/displays/{display_id}")
    async def patch_display(app_id: str, display_id: str, body: dict[str, Any], authorization: str | None = Header(default=None)):
        return await patch(app_id, "display", display_id, body, authorization)

    @app.patch("/api/v1/apps/{app_id}/menus/{menu_id}")
    async def patch_menu(app_id: str, menu_id: str, body: dict[str, Any], authorization: str | None = Header(default=None)):
        return await patch(app_id, "menu", menu_id, body, authorization)

    return app
