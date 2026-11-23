"""Data model shared by the analyzer, planner and generator."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Member:
    """One property of an Ext.define body (method, config value, items tree ...)."""

    name: str
    kind: str  # function | object | array | string | number | boolean | null | identifier | other
    source: str  # exact source text of the value
    node: Any = field(repr=False, default=None)  # esprima AST node of the value
    start: int = 0
    end: int = 0
    calls_parent: bool = False  # function uses callParent/callSuper


@dataclass
class ExtClass:
    name: str
    file: str  # path relative to the app root
    kind: str = "define"  # define | override | application
    extend: str | None = None
    override: str | None = None
    alias: list[str] = field(default_factory=list)  # full aliases: widget.x, controller.y, proxy.z ...
    alternate_names: list[str] = field(default_factory=list)
    requires: list[str] = field(default_factory=list)
    uses: list[str] = field(default_factory=list)
    mixins: list[str] = field(default_factory=list)
    singleton: bool = False
    members: dict[str, Member] = field(default_factory=dict)
    doc: str = ""  # leading /** */ comment
    category: str = "class"  # view | controller | viewmodel | model | store | proxy | util | plugin | override | app | class
    framework_base: str | None = None  # nearest Ext.* ancestor
    ancestors: list[str] = field(default_factory=list)  # app ancestors, nearest first
    source_range: tuple[int, int] = (0, 0)

    @property
    def xtypes(self) -> list[str]:
        return [a.split(".", 1)[1] for a in self.alias if a.startswith("widget.")]

    @property
    def short_name(self) -> str:
        return self.name.rsplit(".", 1)[-1]


@dataclass
class SourceFile:
    path: str  # relative to the app root, forward slashes
    text: str
    kind: str  # js | scss | html | json | asset
    classes: list[str] = field(default_factory=list)
    parse_error: str | None = None
    top_level_other: list[str] = field(default_factory=list)  # statements that are not Ext.define/Ext.application


@dataclass
class Finding:
    level: str  # info | warning | error
    code: str
    message: str
    file: str | None = None
    cls: str | None = None
    line: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class AppInfo:
    root: str  # absolute path of the Ext JS application (folder with app.json)
    name: str = "App"
    toolkit: str = "classic"
    theme: str | None = None
    framework_version: str | None = None
    packages: list[str] = field(default_factory=list)
    classpath: list[str] = field(default_factory=lambda: ["app"])
    overrides: list[str] = field(default_factory=list)
    sass: dict[str, list[str]] = field(default_factory=dict)
    index_html: str | None = None
    app_js: str | None = None
    resources: list[str] = field(default_factory=list)
    app_json: dict[str, Any] = field(default_factory=dict)
