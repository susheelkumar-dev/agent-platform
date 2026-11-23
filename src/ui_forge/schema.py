"""UI Forge display schema, version 1.0: the source of truth for every designed display.

Two kinds of document, both JSON files kept in the application's repository next to the code they produce:

* **Entity** (`<module>/ui-forge/<entity>.entity.json`): the data model once: fields, types, validation, API
  endpoint, permissions and backend options. Summary columns, Entry fields, search fields and the generated
  TypeScript / JavaScript models are all derived from it, so a field is never defined twice.
* **Display** (`<module>/ui-forge/<display>.display.json`): one screen: identity, menu placement, type
  (entry | summary | master-slave), layout, actions and permissions. It refers to entities by name.

Documents carry `schemaVersion`; `migrate()` upgrades older documents before validation. Validation has two
layers: the models below (shape and simple rules) and `semantic.check()` (cross references, conflicts).
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0"

DATA_TYPES = ("string", "text", "integer", "decimal", "currency", "boolean", "date", "datetime", "time", "enum", "lookup")
WIDGETS = ("input", "textarea", "select", "radio", "checkbox", "switch", "multiselect")
ACTION_KINDS = ("save", "delete", "copy", "audit", "reset", "cancel", "new", "open", "refresh", "custom")

ENTITY_NAME = re.compile(r"^[A-Z][A-Za-z0-9]{1,63}$")
FIELD_NAME = re.compile(r"^[a-z][A-Za-z0-9]{0,63}$")
SLUG = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
REGISTRY_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
PERMISSION = re.compile(r"^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$")
ROUTE = re.compile(r"^[a-z0-9][a-z0-9/_-]{0,127}$")
ENDPOINT = re.compile(r"^/[A-Za-z0-9/_{}-]{1,200}$")
KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")

# Names a field may not take: they collide with generated code, JavaScript objects or the API's bookkeeping.
RESERVED_FIELDS = {
    "constructor", "prototype", "__proto__", "toString", "valueOf", "hasOwnProperty",
    "isSystem", "createdAt", "createdBy", "updatedAt", "updatedBy", "version",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# ------------------------------------------------------------------------------------------------ entity
class LookupDef(_Strict):
    endpoint: str = Field(description="API path returning [{id, name}] or an envelope, e.g. '/lookups/regions'")
    valueField: str = "id"
    labelField: str = "name"

    @field_validator("endpoint")
    @classmethod
    def _ep(cls, v: str) -> str:
        if not ENDPOINT.match(v):
            raise ValueError("lookup endpoint must be an API path such as /lookups/regions")
        return v


class EntityField(_Strict):
    name: str
    label: str = Field(min_length=1, max_length=80)
    dataType: Literal["string", "text", "integer", "decimal", "currency", "boolean", "date", "datetime", "time", "enum", "lookup"] = "string"
    multiple: bool = Field(default=False, description="enum / lookup only: the value is a list")
    required: bool = False
    unique: bool = Field(default=False, description="no two records may share the value (case-insensitive for text)")
    maxLength: int | None = Field(default=None, ge=1, le=100000)
    minLength: int | None = Field(default=None, ge=0, le=100000)
    min: float | None = None
    max: float | None = None
    decimals: int | None = Field(default=None, ge=0, le=10)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    pattern: str | None = Field(default=None, max_length=300)
    patternMessage: str | None = Field(default=None, max_length=200)
    options: list[str | int] | None = Field(default=None, description="enum values")
    lookup: LookupDef | None = None
    defaultValue: Any = None
    upperCase: bool = False
    readOnly: bool = Field(default=False, description="shown but never changed through the API")
    example: Any = Field(default=None, description="a valid sample value, used by generated tests and the builder's sample data")
    description: str | None = Field(default=None, max_length=300)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not FIELD_NAME.match(v):
            raise ValueError(f"field name '{v}' must be camelCase letters and digits, starting with a lower-case letter")
        if v in RESERVED_FIELDS:
            raise ValueError(f"field name '{v}' is reserved")
        return v

    @field_validator("pattern")
    @classmethod
    def _pattern(cls, v: str | None) -> str | None:
        if v:
            try:
                re.compile(v)
            except re.error as e:
                raise ValueError(f"pattern is not a valid regular expression: {e}") from e
        return v

    @model_validator(mode="after")
    def _consistent(self) -> EntityField:
        t = self.dataType
        if t == "enum" and not self.options:
            raise ValueError(f"field '{self.name}': an enum needs options")
        if t == "lookup" and not self.lookup:
            raise ValueError(f"field '{self.name}': a lookup needs a lookup source")
        if self.multiple and t not in ("enum", "lookup"):
            raise ValueError(f"field '{self.name}': only enum and lookup fields can hold several values")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError(f"field '{self.name}': min is greater than max")
        if self.minLength is not None and self.maxLength is not None and self.minLength > self.maxLength:
            raise ValueError(f"field '{self.name}': minLength is greater than maxLength")
        if (self.maxLength or self.minLength or self.pattern) and t not in ("string", "text"):
            raise ValueError(f"field '{self.name}': length and pattern rules apply to string and text fields only")
        if (self.min is not None or self.max is not None) and t not in ("integer", "decimal", "currency"):
            raise ValueError(f"field '{self.name}': min and max apply to numeric fields only")
        if self.currency and t != "currency":
            raise ValueError(f"field '{self.name}': currency applies to currency fields only")
        if self.options is not None and t != "enum":
            raise ValueError(f"field '{self.name}': options apply to enum fields only (use dataType 'enum')")
        if self.options is not None and len({str(o) for o in self.options}) != len(self.options):
            raise ValueError(f"field '{self.name}': options must be unique")
        return self


class PermissionModule(_Strict):
    """A permission module the backend declares (new permissions joining the application's catalogue)."""

    module: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    label: str = Field(min_length=1, max_length=80)
    actions: list[str] = Field(default_factory=lambda: ["view", "edit", "delete"])
    actionLabels: dict[str, str] = Field(default_factory=dict)
    grants: dict[str, list[str]] = Field(default_factory=dict, description="role name -> actions granted once, when the module first appears")

    @field_validator("actions")
    @classmethod
    def _actions(cls, v: list[str]) -> list[str]:
        for a in v:
            if not re.match(r"^[a-z][a-z0-9_-]{0,31}$", a):
                raise ValueError(f"action '{a}' must be a lower-case word")
        if len(set(v)) != len(v):
            raise ValueError("actions must be unique")
        return v


class EntityPermissions(_Strict):
    view: str
    create: str
    update: str
    delete: str

    @model_validator(mode="after")
    def _names(self) -> EntityPermissions:
        for k in ("view", "create", "update", "delete"):
            if not PERMISSION.match(getattr(self, k)):
                raise ValueError(f"permission '{getattr(self, k)}' must look like module.action")
        return self


class ParentLink(_Strict):
    """This entity belongs to a parent entity: `field` holds the parent's id (validated by the backend)."""

    entity: str
    field: str
    onParentDelete: Literal["restrict", "cascade"] = "restrict"


class BackendOptions(_Strict):
    generate: bool = Field(default=True, description="false: use an API that already exists at `endpoint`")
    collection: str | None = Field(default=None, pattern=r"^[a-z][A-Za-z0-9]{0,63}$", description="store collection; default camelCase plural")
    auditEntityType: str | None = Field(default=None, max_length=60, description="entityType in the audit trail; default the label")
    customActions: list[str] = Field(default_factory=list, description="POST {endpoint}/:id/<action> routes backed by hooks")


class EntityDef(_Strict):
    schemaVersion: Literal["1.0"] = SCHEMA_VERSION
    kind: Literal["entity"] = "entity"
    name: str = Field(description="PascalCase, e.g. GenerationAsset")
    label: str = Field(min_length=1, max_length=80)
    plural: str = Field(min_length=1, max_length=80)
    module: str = Field(description="module slug, e.g. assets")
    endpoint: str = Field(description="API path relative to the API base, e.g. /generation-assets")
    idField: str = "id"
    titleField: str | None = None
    fields: list[EntityField] = Field(min_length=1)
    permissions: EntityPermissions
    permissionModule: PermissionModule | None = None
    parent: ParentLink | None = None
    backend: BackendOptions = Field(default_factory=BackendOptions)
    description: str | None = Field(default=None, max_length=500)
    revision: int = Field(default=1, ge=1)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not ENTITY_NAME.match(v):
            raise ValueError(f"entity name '{v}' must be PascalCase letters and digits")
        return v

    @field_validator("module")
    @classmethod
    def _module(cls, v: str) -> str:
        if not SLUG.match(v):
            raise ValueError(f"module '{v}' must be a lower-case slug")
        return v

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, v: str) -> str:
        if not ENDPOINT.match(v) or v.endswith("/") or "//" in v:
            raise ValueError(f"endpoint '{v}' must be an API path such as /generation-assets")
        return v

    @model_validator(mode="after")
    def _fields(self) -> EntityDef:
        names = [f.name for f in self.fields]
        dup = sorted({n for n in names if names.count(n) > 1})
        if dup:
            raise ValueError(f"entity {self.name}: duplicate field(s) {', '.join(dup)}")
        if self.idField in names:
            raise ValueError(f"entity {self.name}: '{self.idField}' is the id field and is added automatically")
        if self.titleField and self.titleField not in names:
            raise ValueError(f"entity {self.name}: titleField '{self.titleField}' is not a field")
        if self.parent and self.parent.field not in names:
            raise ValueError(f"entity {self.name}: parent field '{self.parent.field}' is not a field")
        if self.backend.generate and "{" in self.endpoint:
            raise ValueError(f"entity {self.name}: a generated backend needs a plain endpoint (no {{placeholders}})")
        for a in self.backend.customActions:
            if not SLUG.match(a):
                raise ValueError(f"custom action '{a}' must be a lower-case slug")
        return self

    def field(self, name: str) -> EntityField | None:
        return next((f for f in self.fields if f.name == name), None)


# ------------------------------------------------------------------------------------------------ display
class VisibleWhen(_Strict):
    field: str
    equals: list[Any] = Field(min_length=1)


class FormItem(_Strict):
    """A field placed on an Entry form. Everything except `field` overrides the entity's definition."""

    field: str
    span: int = Field(default=1, ge=1, le=12)
    widget: Literal["input", "textarea", "select", "radio", "checkbox", "switch", "multiselect"] | None = None
    label: str | None = Field(default=None, max_length=80)
    placeholder: str | None = Field(default=None, max_length=120)
    help: str | None = Field(default=None, max_length=300)
    readOnly: bool | None = None
    readOnlyOnEdit: bool | None = None
    hidden: bool | None = None
    visibleWhen: VisibleWhen | None = None
    defaultValue: Any = None
    validator: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")


class Section(_Strict):
    id: str = Field(pattern=r"^[a-z][a-z0-9-]{0,63}$")
    title: str | None = Field(default=None, max_length=80)
    kind: Literal["panel", "fieldset", "tab", "plain"] = "panel"
    columns: int | None = Field(default=None, ge=1, le=12)
    collapsible: bool = False
    collapsed: bool = False
    description: str | None = Field(default=None, max_length=300)
    items: list[FormItem] = Field(default_factory=list)


class Action(_Strict):
    id: str = Field(pattern=r"^[a-z][a-z0-9-]{0,63}$")
    kind: Literal["save", "delete", "copy", "audit", "reset", "cancel", "new", "open", "refresh", "custom"]
    label: str | None = Field(default=None, max_length=60)
    permission: str | None = Field(default=None, description="action key in the display's actionPermissions (create, update, delete, or a custom key)")
    confirm: str | None = Field(default=None, max_length=200)
    path: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9-]{0,63}$", description="custom: POST {endpoint}/{id}/{path}")
    style: Literal["primary", "danger", "default"] | None = None
    icon: str | None = Field(default=None, max_length=60)


class EntryLayout(_Strict):
    columns: int = Field(default=2, ge=1, le=12)
    sections: list[Section] = Field(min_length=1)
    actions: list[Action] = Field(default_factory=list)
    copyExclude: list[str] = Field(default_factory=list)
    summaryDisplay: str | None = Field(default=None, description="display opened after Close")


class Column(_Strict):
    field: str
    label: str | None = Field(default=None, max_length=80)
    width: int | None = Field(default=None, ge=40, le=1200)
    flex: float | None = Field(default=None, gt=0, le=10)
    align: Literal["left", "center", "right"] | None = None
    format: str | None = Field(default=None, max_length=40)
    decimals: int | None = Field(default=None, ge=0, le=10)
    sortable: bool = True
    filter: bool | Literal["text", "number", "date", "list"] = True
    hidden: bool = False
    renderer: str | None = Field(default=None, max_length=60)
    badgeTones: dict[str, Literal["gray", "blue", "green", "red", "amber"]] | None = None


class SearchField(_Strict):
    field: str
    label: str | None = Field(default=None, max_length=80)
    operator: Literal["eq", "contains", "gte", "lte", "between", "in"] = "eq"
    param: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9]{0,63}$")
    required: bool = False
    defaultValue: Any = None
    placeholder: str | None = Field(default=None, max_length=80)


class Sorter(_Strict):
    field: str
    direction: Literal["ASC", "DESC"] = "ASC"


class SummaryLayout(_Strict):
    columns: list[Column] = Field(min_length=1)
    searchFields: list[SearchField] = Field(default_factory=list)
    remote: bool = Field(default=False, description="server paging, sorting and filtering")
    pageSize: int | None = Field(default=None, ge=5, le=1000)
    sorters: list[Sorter] = Field(default_factory=list)
    toolbarActions: list[Action] = Field(default_factory=list)
    rowActions: list[Action] = Field(default_factory=list)
    emptyText: str | None = Field(default=None, max_length=200)
    selection: Literal["single", "multi"] = "single"
    autoLoad: bool = True
    entryDisplay: str | None = Field(default=None, description="display id opened by New / Open")
    features: dict[str, Any] = Field(default_factory=dict, description="DataGrid feature switches (grouping, summary, rowNumbers ...)")


class MasterPanel(_Strict):
    entity: str
    summary: SummaryLayout


class DetailPanel(_Strict):
    entity: str
    relation: Literal["same", "child"] = "same"
    linkField: str | None = Field(default=None, description="child field holding the master's key")
    masterKey: str | None = None
    entry: EntryLayout
    summary: SummaryLayout | None = Field(default=None, description="child list (relation 'child')")


class MasterSlaveLayout(_Strict):
    master: MasterPanel
    detail: DetailPanel
    orientation: Literal["horizontal", "vertical"] = "horizontal"
    split: int = Field(default=45, ge=20, le=80)
    unsavedChanges: Literal["confirm", "discard", "block"] = "confirm"
    stackBelow: int = Field(default=900, ge=0, le=4000)


class MenuFolder(_Strict):
    id: str
    title: str = Field(min_length=1, max_length=80)
    parent: str | None = None
    icon: str | None = Field(default=None, max_length=60)
    sortOrder: int = 100


class MenuEntry(_Strict):
    id: str
    title: str = Field(min_length=1, max_length=80)
    parent: str | None = Field(default=None, description="folder id; null = top level")
    icon: str | None = Field(default=None, max_length=60)
    sortOrder: int = 100
    action: str | None = Field(default=None, max_length=64)
    params: dict[str, str | int | float | bool] = Field(default_factory=dict)
    requiredPermissions: list[str] = Field(default_factory=list)
    enabled: bool = True


class DisplayPermissions(_Strict):
    required: list[str] = Field(default_factory=list, description="all needed to see or open the display; default the entity's view")
    actions: dict[str, str] = Field(default_factory=dict, description="action key -> permission; default from the entity")


class GeneratorOptions(_Strict):
    frontend: bool = True
    backend: bool = True
    tests: bool = True


class DisplaySchema(_Strict):
    schemaVersion: Literal["1.0"] = SCHEMA_VERSION
    kind: Literal["display"] = "display"
    id: str = Field(description="registry display id, e.g. assets.generation-assets")
    name: str = Field(description="PascalCase implementation key, e.g. GenerationAssetSummary")
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    type: Literal["entry", "summary", "master-slave"]
    module: str
    route: str | None = None
    icon: str | None = Field(default=None, max_length=60)
    openMode: Literal["tab", "window", "page"] = "tab"
    entity: str | None = Field(default=None, description="entry / summary: the entity shown")
    menu: MenuEntry | None = None
    folders: list[MenuFolder] = Field(default_factory=list, description="new menu folders this display creates")
    permissions: DisplayPermissions = Field(default_factory=DisplayPermissions)
    entry: EntryLayout | None = None
    summary: SummaryLayout | None = None
    masterSlave: MasterSlaveLayout | None = None
    generator: GeneratorOptions = Field(default_factory=GeneratorOptions)
    revision: int = Field(default=1, ge=1)

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not REGISTRY_ID.match(v):
            raise ValueError(f"display id '{v}' must be lower case letters, digits, '.', '_' or '-'")
        return v

    @field_validator("name")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY.match(v) or not v[0].isupper():
            raise ValueError(f"display name '{v}' must be PascalCase (it becomes the implementation key and the component name)")
        return v

    @field_validator("module")
    @classmethod
    def _module(cls, v: str) -> str:
        if not SLUG.match(v):
            raise ValueError(f"module '{v}' must be a lower-case slug")
        return v

    @field_validator("route")
    @classmethod
    def _route(cls, v: str | None) -> str | None:
        if v is not None and (not ROUTE.match(v) or v.endswith("/") or "//" in v):
            raise ValueError(f"route '{v}' must be a path such as assets/generation-assets")
        return v

    @model_validator(mode="after")
    def _layout(self) -> DisplaySchema:
        need = {"entry": "entry", "summary": "summary", "master-slave": "masterSlave"}[self.type]
        for k in ("entry", "summary", "masterSlave"):
            v = getattr(self, k)
            if k == need and v is None:
                raise ValueError(f"a {self.type} display needs '{k}'")
            if k != need and v is not None:
                raise ValueError(f"a {self.type} display cannot have '{k}'")
        if self.type in ("entry", "summary") and not self.entity:
            raise ValueError(f"a {self.type} display needs 'entity'")
        if self.type == "master-slave" and self.entity:
            raise ValueError("a master-slave display names its entities in masterSlave.master / masterSlave.detail")
        ids = [f.id for f in self.folders] + ([self.menu.id] if self.menu else [])
        for i in ids:
            if not REGISTRY_ID.match(i):
                raise ValueError(f"menu id '{i}' must be lower case letters, digits, '.', '_' or '-'")
        if len(set(ids)) != len(ids):
            raise ValueError("menu and folder ids must be unique")
        return self

    @property
    def registry_type(self) -> str:
        return {"entry": "entry-form", "summary": "summary", "master-slave": "master-slave"}[self.type]

    def entities(self) -> list[str]:
        if self.type == "master-slave" and self.masterSlave:
            return [self.masterSlave.master.entity, self.masterSlave.detail.entity]
        return [self.entity] if self.entity else []


# ------------------------------------------------------------------------------------------------ versions
def migrate(doc: dict[str, Any]) -> dict[str, Any]:
    """Upgrades a document to the current schemaVersion. Unknown future versions are refused."""
    v = str(doc.get("schemaVersion", "")).strip()
    if v in ("1", "1.0"):
        doc = dict(doc)
        doc["schemaVersion"] = SCHEMA_VERSION
        return doc
    if v == "":
        raise ValueError("schemaVersion is missing")
    raise ValueError(f"schemaVersion {v} is not supported by this UI Forge (supports {SCHEMA_VERSION})")


def parse_entity(doc: dict[str, Any]) -> EntityDef:
    return EntityDef.model_validate(migrate(doc))


def parse_display(doc: dict[str, Any]) -> DisplaySchema:
    return DisplaySchema.model_validate(migrate(doc))


def json_schemas() -> dict[str, Any]:
    """JSON Schema of both documents (for editors, CI and the builder)."""
    return {"entity": EntityDef.model_json_schema(), "display": DisplaySchema.model_json_schema(), "version": SCHEMA_VERSION}
