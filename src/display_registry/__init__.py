"""Display registry: database-backed menus and display registration for front-end applications.

A separate service on the platform's database. Applications keep their own sign-in and permissions; the
registry validates their tokens, checks manifests against their permission catalog, and serves each user the
menu they are allowed to see.
"""

from .manifest import DisplayDef, MenuDef, ModuleInfo, ModuleManifest, manifest_json_schema

__all__ = ["DisplayDef", "MenuDef", "ModuleInfo", "ModuleManifest", "manifest_json_schema"]
