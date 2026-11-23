"""Module registration manifest (contract v1).

A module manifest declares the displays a front-end module provides and the menu entries that open them. It is
pure data: registration never executes code from a module. The same models validate a manifest in the CLI
(``agentctl display``), in the registry service and in tests; ``python -m display_registry.schema`` prints the
JSON Schema used by editors and the front-end framework.

Identifiers are stable keys (``reference.counterparties.summary``), separate from the titles people see.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,127}$")
PERMISSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$")

# Built-in display types. "custom" covers everything else, including screens still running on the
# compatibility runtime. More types can be added without a schema change: the type is validated against
# DisplayTypes registered for the app (default: these four).
BUILTIN_DISPLAY_TYPES = ("entry-form", "summary", "master-slave", "custom")
ACTIONS = ("create", "update", "delete", "approve", "export")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def _check_id(v: str, what: str) -> str:
    if not ID_RE.match(v):
        raise ValueError(f"{what} '{v}' must be lower case letters, digits, '.', '_' or '-' (max 128), starting with a letter or digit")
    return v


def _check_perms(values: list[str]) -> list[str]:
    for p in values:
        if not PERMISSION_RE.match(p):
            raise ValueError(f"permission '{p}' is not a valid permission name")
    return sorted(set(values))


class DisplayParam(_Strict):
    """A value the display needs to open, e.g. the record id of an Entry display."""

    name: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
    required: bool = False
    description: str = ""


class DisplayDef(_Strict):
    id: str
    title: str = Field(min_length=1, max_length=200)
    type: str = Field(description="entry-form | summary | master-slave | custom, or a type the app registers")
    key: str = Field(description="Implementation key in the front-end's approved display registry")
    route: str | None = Field(default=None, description="Path segment for deep links; default 'd/<id>'")
    open_mode: Literal["tab", "window", "page"] = Field(default="tab", alias="openMode")
    params: list[DisplayParam] = Field(default_factory=list)
    required_permissions: list[str] = Field(default_factory=list, alias="requiredPermissions")
    action_permissions: dict[str, str] = Field(default_factory=dict, alias="actionPermissions")
    icon: str | None = None
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict, description="Template-specific configuration")

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        return _check_id(v, "display id")

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v):
            raise ValueError(f"display key '{v}' must be an identifier (letters, digits, '_')")
        return v

    @field_validator("route")
    @classmethod
    def _route(cls, v: str | None) -> str | None:
        if v is not None and not re.match(r"^[a-z0-9][a-z0-9/_-]{0,199}$", v):
            raise ValueError(f"route '{v}' must be lower case path segments")
        return v

    @field_validator("required_permissions")
    @classmethod
    def _perms(cls, v: list[str]) -> list[str]:
        return _check_perms(v)

    @field_validator("action_permissions")
    @classmethod
    def _actions(cls, v: dict[str, str]) -> dict[str, str]:
        for action, perm in v.items():
            if not re.match(r"^[a-z][a-z0-9_-]{0,31}$", action):
                raise ValueError(f"action '{action}' must be a lower case word")
            _check_perms([perm])
        return dict(sorted(v.items()))


class MenuDef(_Strict):
    """A menu entry. Without ``display`` it is a folder that groups other entries."""

    id: str
    title: str = Field(min_length=1, max_length=200)
    parent: str | None = None
    display: str | None = None
    params: dict[str, str | int | float | bool] = Field(default_factory=dict)
    action: str | None = Field(default=None, max_length=64, description="Passed to the display, e.g. 'new'")
    icon: str | None = None
    sort_order: int = Field(default=100, alias="sortOrder")
    enabled: bool = True
    required_permissions: list[str] = Field(default_factory=list, alias="requiredPermissions")

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        return _check_id(v, "menu id")

    @field_validator("parent")
    @classmethod
    def _parent(cls, v: str | None) -> str | None:
        return None if v is None else _check_id(v, "parent menu id")

    @field_validator("display")
    @classmethod
    def _display(cls, v: str | None) -> str | None:
        return None if v is None else _check_id(v, "display id")

    @field_validator("required_permissions")
    @classmethod
    def _perms(cls, v: list[str]) -> list[str]:
        return _check_perms(v)


class ModuleInfo(_Strict):
    id: str
    version: str
    title: str = ""
    owner: str = ""

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        return _check_id(v, "module id")

    @field_validator("version")
    @classmethod
    def _version(cls, v: str) -> str:
        if not VERSION_RE.match(v):
            raise ValueError(f"version '{v}' must be semantic (1.2.3)")
        return v


class ModuleManifest(_Strict):
    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    app: str
    module: ModuleInfo
    displays: list[DisplayDef] = Field(default_factory=list)
    menus: list[MenuDef] = Field(default_factory=list)

    @field_validator("app")
    @classmethod
    def _app(cls, v: str) -> str:
        return _check_id(v, "app id")

    @model_validator(mode="after")
    def _unique_and_local_refs(self) -> ModuleManifest:
        problems: list[str] = []
        for kind, items in (("display", self.displays), ("menu", self.menus)):
            seen: set[str] = set()
            for it in items:
                if it.id in seen:
                    problems.append(f"duplicate {kind} id '{it.id}'")
                seen.add(it.id)
        for m in self.menus:
            if m.parent == m.id:
                problems.append(f"menu '{m.id}' cannot be its own parent")
        # cycles inside this manifest
        parents = {m.id: m.parent for m in self.menus}
        for start in parents:
            node, hops = start, 0
            while node in parents and parents[node] and hops <= len(parents):
                node = parents[node]
                hops += 1
                if node == start:
                    problems.append(f"menu '{start}' is part of a parent cycle")
                    break
        for d in self.displays:
            names = [p.name for p in d.params]
            if len(names) != len(set(names)):
                problems.append(f"display '{d.id}' declares a parameter twice")
        if problems:
            raise ValueError("; ".join(problems))
        return self


def manifest_json_schema() -> dict[str, Any]:
    schema = ModuleManifest.model_json_schema(by_alias=True)
    schema["$id"] = "https://ai-agent-platform/schemas/module-manifest.v1.json"
    schema["title"] = "Module registration manifest v1"
    return schema
