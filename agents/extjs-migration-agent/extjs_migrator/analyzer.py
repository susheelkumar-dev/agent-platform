"""Build the class graph and the inventory of Ext JS framework features an application uses.

Output (``Analysis``) drives everything after it: the generator's load order, the coverage check against
the React runtime's catalogue, and the migration report.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

from .jsast import member_chain, parse, prop_key, try_literal, walk
from .model import AppInfo, ExtClass, Finding, SourceFile
from .parser import parse_file

# Keys whose string value names a class by alias, with the alias prefix it uses.
TYPED_KEYS = {
    "xtype": "widget", "ptype": "plugin", "ftype": "feature", "controller": "controller", "viewModel": "viewmodel",
}
# 'type' inside these keys names an alias of that family.
TYPE_CONTAINERS = {
    "layout": "layout", "proxy": "proxy", "reader": "reader", "writer": "writer", "selModel": "selection",
    "store": "store", "viewModel": "viewmodel", "axes": "axis", "series": "series", "legend": "legend",
    "interactions": "interaction", "identifier": "data.identifier", "validators": "data.validator",
    "plugins": "plugin", "features": "feature", "stores": "store", "sorters": "sorter", "renderer": "",
}

COMPONENT_BASES_PREFIX = (
    "Ext.Component", "Ext.container.", "Ext.panel.", "Ext.grid.Panel", "Ext.grid.column.", "Ext.form.",
    "Ext.window.", "Ext.tab.", "Ext.toolbar.", "Ext.button.", "Ext.menu.", "Ext.chart.", "Ext.draw.",
    "Ext.view.", "Ext.tree.Panel", "Ext.Img", "Ext.picker.", "Ext.slider.", "Ext.tip.", "Ext.ProgressBar",
    "Ext.resizer.", "Ext.dashboard.", "Ext.list.", "Ext.Container", "Ext.Panel",
)
CATEGORY_BY_BASE = [
    (("Ext.app.ViewController", "Ext.app.Controller"), "controller"),
    (("Ext.app.ViewModel",), "viewmodel"),
    (("Ext.data.Model", "Ext.data.TreeModel"), "model"),
    (("Ext.data.Store", "Ext.data.ChainedStore", "Ext.data.TreeStore", "Ext.data.BufferedStore", "Ext.data.ArrayStore",
      "Ext.data.JsonStore", "Ext.data.AbstractStore"), "store"),
    (("Ext.data.proxy.",), "proxy"),
    (("Ext.data.reader.", "Ext.data.writer."), "proxy"),
    (("Ext.plugin.", "Ext.AbstractPlugin", "Ext.grid.plugin.", "Ext.grid.selection."), "plugin"),
    (("Ext.grid.feature.",), "plugin"),
    (("Ext.app.Application",), "app"),
    (("Ext.Mixin",), "mixin"),
    (("Ext.data.validator.",), "validator"),
]

BIND_RE = re.compile(r"\{([!]?[\w.$]+)\}")


@dataclass
class Analysis:
    info: AppInfo
    files: list[SourceFile]
    classes: dict[str, ExtClass]
    findings: list[Finding] = field(default_factory=list)
    aliases: dict[str, str] = field(default_factory=dict)  # alias -> class name (app classes)
    deps: dict[str, set[str]] = field(default_factory=dict)  # class -> app classes it needs loaded first
    refs: dict[str, set[str]] = field(default_factory=dict)  # class -> app classes it references at all
    order: list[str] = field(default_factory=list)  # load order (dependencies first)
    framework_classes: Counter = field(default_factory=Counter)  # Ext.* class names referenced
    framework_aliases: Counter = field(default_factory=Counter)  # e.g. widget.grid, layout.border, plugin.cellediting
    framework_apis: Counter = field(default_factory=Counter)  # Ext.* member chains used in code (Ext.Msg.confirm)
    member_calls: Counter = field(default_factory=Counter)  # .method( names called anywhere
    configs_by_type: dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))  # widget.x -> config keys
    events_listened: Counter = field(default_factory=Counter)
    events_fired: Counter = field(default_factory=Counter)
    bind_paths: Counter = field(default_factory=Counter)
    routes: list[dict[str, Any]] = field(default_factory=list)
    templates: list[dict[str, Any]] = field(default_factory=list)
    namespace: str = ""

    def app_class(self, name_or_alias: str) -> ExtClass | None:
        if name_or_alias in self.classes:
            return self.classes[name_or_alias]
        target = self.aliases.get(name_or_alias)
        return self.classes.get(target) if target else None


def _category(cls: ExtClass) -> str:
    if cls.kind == "override":
        return "override"
    if cls.kind == "application":
        return "app"
    base = cls.framework_base or ""
    for prefixes, cat in CATEGORY_BY_BASE:
        if any(base == p or (p.endswith(".") and base.startswith(p)) for p in prefixes):
            return cat
    if any(base == p or base.startswith(p) for p in COMPONENT_BASES_PREFIX):
        return "view"
    if cls.singleton:
        return "util"
    return "class"


def analyze(info: AppInfo, files: list[SourceFile]) -> Analysis:
    findings: list[Finding] = []
    classes: dict[str, ExtClass] = {}
    for sf in files:
        if sf.kind != "js":
            continue
        for cls in parse_file(sf, findings):
            if cls.name in classes:
                findings.append(Finding("warning", "duplicate-class", f"{cls.name} is defined twice", file=sf.path))
            classes[cls.name] = cls
        if sf.top_level_other:
            findings.append(Finding("info", "top-level-code", f"{len(sf.top_level_other)} statement(s) outside Ext.define",
                                    file=sf.path))
    a = Analysis(info=info, files=files, classes=classes, findings=findings)

    # Namespace: application name, else the most common first segment.
    first = Counter(n.split(".")[0] for n in classes if not n.startswith("Ext."))
    a.namespace = info.name if info.name in first or not first else first.most_common(1)[0][0]

    # Alias index.
    for cls in classes.values():
        for al in cls.alias:
            if al in a.aliases and a.aliases[al] != cls.name:
                findings.append(Finding("warning", "duplicate-alias", f"alias {al} used by {a.aliases[al]} and {cls.name}",
                                        cls=cls.name, file=cls.file))
            a.aliases[al] = cls.name
        for alt in cls.alternate_names:
            a.aliases[alt] = cls.name

    # Hierarchy.
    for cls in classes.values():
        chain, cur, seen = [], cls, {cls.name}
        base = None
        while True:
            parent = cur.extend if cur.kind != "override" else None
            if cur.kind == "override":
                base = cur.override
                break
            if not parent:
                base = "Ext.Base" if cur.kind != "application" else "Ext.app.Application"
                if cur.kind == "application" and "extend" in cur.members:
                    p = try_literal(cur.members["extend"].node)
                    if isinstance(p, str) and p in classes:
                        chain.append(p)
                        cur = classes[p]
                        continue
                break
            if parent in classes and parent not in seen:
                chain.append(parent)
                seen.add(parent)
                cur = classes[parent]
                continue
            base = parent
            break
        cls.ancestors = chain
        cls.framework_base = base
    for cls in classes.values():
        cls.category = _category(cls)

    _inventory(a)
    _dependencies(a)
    _check_unresolved(a)
    return a


# ---------------------------------------------------------------- inventory

def _record_type(a: Analysis, family: str, value: str, cls: ExtClass) -> None:
    if not family or not isinstance(value, str):
        return
    full = f"{family}.{value}"
    if full in a.aliases or value in a.classes:
        a.refs[cls.name].add(a.aliases.get(full) or value)
    else:
        a.framework_aliases[full] += 1


def _inventory(a: Analysis) -> None:
    ns = a.namespace
    for name in a.classes:
        a.refs[name] = set()
    by_file: dict[str, list[ExtClass]] = defaultdict(list)
    for cls in a.classes.values():
        by_file[cls.file].append(cls)
    for sf in a.files:
        if sf.kind != "js" or sf.parse_error:
            continue
        program = parse(sf.text)
        owners = sorted(by_file.get(sf.path, []), key=lambda c: c.source_range[0])

        def owner(pos: int) -> ExtClass | None:
            for c in owners:
                if c.source_range[0] <= pos <= c.source_range[1]:
                    return c
            return None

        for node, parents in walk(program):
            t = node.type
            if t == "MemberExpression" and not (parents and parents[-1].type == "MemberExpression" and parents[-1].object is node):
                chain = member_chain(node)
                if not chain:
                    continue
                c = owner(node.range[0])
                head = chain.split(".")[0]
                if head == "Ext":
                    a.framework_apis[chain] += 1
                elif head == ns and c is not None:
                    # GT.util.Session.can -> GT.util.Session
                    parts = chain.split(".")
                    for i in range(len(parts), 1, -1):
                        cand = ".".join(parts[:i])
                        if cand in a.classes:
                            a.refs[c.name].add(cand)
                            break
            elif t == "CallExpression":
                callee = node.callee
                if callee.type == "MemberExpression" and not callee.computed:
                    meth = callee.property.name
                    if member_chain(callee) is None or not member_chain(callee).startswith("Ext."):
                        a.member_calls[meth] += 1
                    c = owner(node.range[0])
                    args = node.arguments
                    if meth in ("on", "un", "mon", "addListener", "mun") and args:
                        i = 1 if meth in ("mon", "mun") else 0
                        if len(args) > i:
                            ev = try_literal(args[i])
                            if isinstance(ev, str):
                                a.events_listened[ev] += 1
                            elif args[i].type == "ObjectExpression":
                                for p in args[i].properties:
                                    k = prop_key(p)
                                    if k and k not in ("scope", "single", "buffer", "delay", "destroyable", "element", "args", "priority", "order"):
                                        a.events_listened[k] += 1
                    if meth == "fireEvent" and args:
                        ev = try_literal(args[0])
                        if isinstance(ev, str):
                            a.events_fired[ev] += 1
                    chain = member_chain(callee) or ""
                    if chain in ("Ext.create", "Ext.widget", "Ext.ClassManager.get", "Ext.ClassManager.getByAlias") and args and c:
                        v = try_literal(args[0])
                        if isinstance(v, str):
                            if chain == "Ext.widget":
                                _record_type(a, "widget", v, c)
                            elif v in a.classes:
                                a.refs[c.name].add(v)
                            elif v.startswith("Ext."):
                                a.framework_classes[v] += 1
                            elif "." in v and v.split(".")[0] in ("widget", "plugin", "store", "layout", "proxy"):
                                fam, al = v.split(".", 1)
                                _record_type(a, fam, al, c)
                    if meth == "redirectTo" or meth == "setRoutes":
                        pass
            elif t == "ObjectExpression":
                c = owner(node.range[0])
                if c is None:
                    continue
                keys = {prop_key(p): p for p in node.properties if prop_key(p)}
                parent_key = None
                if parents and parents[-1].type == "Property":
                    parent_key = prop_key(parents[-1])
                elif len(parents) >= 2 and parents[-1].type == "ArrayExpression" and parents[-2].type == "Property":
                    parent_key = prop_key(parents[-2])
                for key, family in TYPED_KEYS.items():
                    if key in keys:
                        v = try_literal(keys[key].value)
                        if isinstance(v, str):
                            _record_type(a, family, v, c)
                if "type" in keys and parent_key in TYPE_CONTAINERS:
                    v = try_literal(keys["type"].value)
                    if isinstance(v, str):
                        _record_type(a, TYPE_CONTAINERS[parent_key], v, c)
                if "xtype" in keys:
                    v = try_literal(keys["xtype"].value)
                    if isinstance(v, str):
                        for k in keys:
                            a.configs_by_type[f"widget.{v}"][k] += 1
                if parent_key == "listeners":
                    for k in keys:
                        if k not in ("scope", "single", "buffer", "delay", "element", "order"):
                            a.events_listened[k] += 1
                if parent_key == "bind" or "bind" in keys:
                    target = keys.get("bind").value if "bind" in keys else node
                    for n2, _ in walk(target):
                        if n2.type == "Literal" and isinstance(n2.value, str):
                            for m in BIND_RE.findall(n2.value):
                                a.bind_paths[m] += 1
            elif t == "Property":
                k = prop_key(node)
                c = owner(node.range[0])
                if c is None or k is None:
                    continue
                v = node.value
                if k in ("layout", "selModel", "store", "defaultType", "defaultListenerScope") and v.type == "Literal" and isinstance(v.value, str):
                    fam = {"layout": "layout", "selModel": "selection", "store": "store", "defaultType": "widget"}.get(k)
                    if fam:
                        _record_type(a, fam, v.value, c)
                if k in ("plugins", "features") and v.type in ("ArrayExpression", "Literal"):
                    for e in (v.elements if v.type == "ArrayExpression" else [v]):
                        s = try_literal(e)
                        if isinstance(s, str):
                            _record_type(a, "plugin" if k == "plugins" else "feature", s, c)
                if k in ("extend", "override", "requires", "uses", "mixins", "model"):
                    vals = []
                    for n2, _ in walk(v):
                        if n2.type == "Literal" and isinstance(n2.value, str):
                            vals.append(n2.value)
                    for s in vals:
                        if s in a.classes:
                            a.refs[c.name].add(s)
                        elif s.startswith("Ext."):
                            a.framework_classes[s] += 1
                if k in ("tpl", "rowBodyTpl", "groupHeaderTpl", "itemTpl", "displayTpl", "tooltipTpl", "headerTpl"):
                    a.templates.append({"class": c.name, "key": k, "file": sf.path, "line": node.loc.start.line})
                if k == "routes" and v.type == "ObjectExpression":
                    for p in v.properties:
                        a.routes.append({"class": c.name, "route": prop_key(p), "handler": try_literal(p.value, "(config)")})
    # framework base classes count as referenced too
    for cls in a.classes.values():
        if cls.framework_base and cls.framework_base.startswith("Ext."):
            a.framework_classes[cls.framework_base] += 1


def _dependencies(a: Analysis) -> None:
    """Load-order dependencies: what must be defined before a class can be defined (extend, mixins, override target)."""
    for cls in a.classes.values():
        hard = set()
        if cls.extend in a.classes:
            hard.add(cls.extend)
        for m in cls.mixins:
            if m in a.classes:
                hard.add(m)
        if cls.kind == "application" and "extend" in cls.members:
            p = try_literal(cls.members["extend"].node)
            if p in a.classes:
                hard.add(p)
        if cls.override in a.classes:
            hard.add(cls.override)
        a.deps[cls.name] = hard
        a.refs[cls.name] |= hard
        a.refs[cls.name].discard(cls.name)
    # Topological order; overrides come right after their target, the application last.
    order, state = [], {}

    def visit(n: str, stack: list[str]) -> None:
        s = state.get(n)
        if s == 2:
            return
        if s == 1:
            a.findings.append(Finding("warning", "cycle", "inheritance cycle: " + " -> ".join(stack + [n]), cls=n))
            return
        state[n] = 1
        for d in sorted(a.deps.get(n, ())):
            visit(d, stack + [n])
        state[n] = 2
        order.append(n)

    names = sorted(a.classes, key=lambda n: (a.classes[n].kind == "application", a.classes[n].kind != "override", n))
    for n in names:
        visit(n, [])
    app = [n for n in order if a.classes[n].kind == "application"]
    a.order = [n for n in order if a.classes[n].kind != "application"] + app


def _check_unresolved(a: Analysis) -> None:
    ns = a.namespace + "."
    for cls in a.classes.values():
        for r in cls.requires + cls.uses:
            if r.startswith(ns) and r not in a.classes and not r.endswith("*"):
                a.findings.append(Finding("warning", "missing-class", f"{cls.name} requires {r}, which is not in the app",
                                          cls=cls.name, file=cls.file))
        if cls.extend and cls.extend.startswith(ns) and cls.extend not in a.classes:
            a.findings.append(Finding("error", "missing-base", f"{cls.name} extends {cls.extend}, which is not in the app",
                                      cls=cls.name, file=cls.file))
