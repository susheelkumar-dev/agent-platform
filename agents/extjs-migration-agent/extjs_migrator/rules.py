"""Deterministic rules applied to every Ext JS source file before it becomes an ES module.

The runtime implements the Ext JS API, so most code ports unchanged. What changes is the execution model:
Sencha Cmd concatenated sloppy-mode scripts, the output is strict-mode ES modules evaluated in dependency
order. The rules find (and where it is safe, fix) what breaks under that model:

* implicit globals (assignment to an undeclared name)    -> declared on globalThis, reported
* `this` at the top level of a file                       -> globalThis
* with statements, arguments.callee, octal literals,
  duplicate parameter names, delete of a plain name        -> reported for the LLM pass / manual fix
* Ext.Loader / Ext.require / Ext.syncRequire               -> kept (no-ops in the runtime), reported as info
* framework classes, aliases and Ext.* APIs that the runtime does not implement -> reported, and the
  members that use them are queued for the LLM pass
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .analyzer import Analysis
from .jsast import member_chain, parse, walk
from .manifest import RuntimeManifest
from .model import Finding

BROWSER_GLOBALS = {
    "window", "document", "navigator", "location", "history", "console", "setTimeout", "clearTimeout", "setInterval",
    "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "sessionStorage", "fetch",
    "XMLHttpRequest", "FormData", "Blob", "File", "FileReader", "URL", "URLSearchParams", "Event", "CustomEvent",
    "MouseEvent", "KeyboardEvent", "HTMLElement", "Element", "Node", "NodeList", "Image", "Audio", "alert", "confirm",
    "prompt", "atob", "btoa", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape",
    "JSON", "Math", "Date", "RegExp", "Array", "Object", "String", "Number", "Boolean", "Symbol", "Map", "Set", "WeakMap",
    "WeakSet", "Promise", "Proxy", "Reflect", "Error", "TypeError", "RangeError", "SyntaxError", "Intl", "parseInt",
    "parseFloat", "isNaN", "isFinite", "NaN", "Infinity", "undefined", "globalThis", "self", "performance", "crypto",
    "TextEncoder", "TextDecoder", "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array",
    "Float32Array", "Float64Array", "ArrayBuffer", "DataView", "getComputedStyle", "matchMedia", "ResizeObserver",
    "MutationObserver", "IntersectionObserver", "WebSocket", "Worker", "structuredClone", "queueMicrotask", "arguments",
    "Ext", "Function", "eval", "BigInt", "AbortController", "Headers", "Request", "Response", "SVGElement", "DOMParser",
    "XMLSerializer", "screen", "devicePixelRatio", "innerWidth", "innerHeight", "scrollX", "scrollY", "open", "print",
    "CSS", "DocumentFragment", "Range", "Selection", "getSelection", "postMessage", "addEventListener",
    "removeEventListener", "dispatchEvent", "indexedDB", "caches", "Notification",
}

FUNC_TYPES = ("FunctionExpression", "FunctionDeclaration", "ArrowFunctionExpression")


@dataclass
class FileRules:
    path: str
    text: str  # transformed source
    findings: list[Finding] = field(default_factory=list)
    implicit_globals: list[str] = field(default_factory=list)
    llm_targets: list[dict[str, Any]] = field(default_factory=list)  # {cls, member, reason, start, end}


def _declared_in(scope_node: Any) -> set[str]:
    """Names declared directly in a function / program scope (var hoisting, params, function declarations)."""
    names: set[str] = set()
    if scope_node.type in FUNC_TYPES:
        for p in scope_node.params:
            names |= _pattern_names(p)
        if scope_node.type != "ArrowFunctionExpression" and getattr(scope_node, "id", None) is not None:
            names.add(scope_node.id.name)
        body = scope_node.body
    else:
        body = scope_node
    for n, ps in walk(body):
        # stop at nested functions (their declarations are theirs), but record function declaration names
        if n is not body and n.type in FUNC_TYPES:
            continue
        if any(p.type in FUNC_TYPES and p is not scope_node for p in ps):
            continue
        if n.type == "VariableDeclaration":
            for d in n.declarations:
                names |= _pattern_names(d.id)
        elif n.type == "FunctionDeclaration" and n.id is not None:
            names.add(n.id.name)
        elif n.type == "ClassDeclaration" and n.id is not None:
            names.add(n.id.name)
        elif n.type == "CatchClause" and n.param is not None:
            names |= _pattern_names(n.param)
    return names


def _pattern_names(p: Any) -> set[str]:
    if p is None:
        return set()
    t = p.type
    if t == "Identifier":
        return {p.name}
    if t == "AssignmentPattern":
        return _pattern_names(p.left)
    if t == "RestElement":
        return _pattern_names(p.argument)
    if t == "ArrayPattern":
        out: set[str] = set()
        for e in p.elements:
            out |= _pattern_names(e)
        return out
    if t == "ObjectPattern":
        out = set()
        for prop in p.properties:
            out |= _pattern_names(prop.value if prop.type == "Property" else prop.argument)
        return out
    return set()


def apply_rules(path: str, text: str, analysis: Analysis, manifest: RuntimeManifest) -> FileRules:
    res = FileRules(path=path, text=text)
    try:
        program = parse(text)
    except Exception as e:  # noqa: BLE001 - esprima raises its own error types
        res.findings.append(Finding("error", "parse-error", f"cannot parse: {e}", file=path))
        res.llm_targets.append({"cls": None, "member": None, "reason": f"syntax error: {e}", "start": 0, "end": len(text)})
        return res

    ns = analysis.namespace
    known_globals = BROWSER_GLOBALS | {ns} | {c.split(".")[0] for c in analysis.classes}
    scope_cache: dict[int, set[str]] = {}

    def declared(node: Any) -> set[str]:
        key = id(node)
        if key not in scope_cache:
            scope_cache[key] = _declared_in(node)
        return scope_cache[key]

    top_decl = declared(program)
    edits: list[tuple[int, int, str]] = []
    implicit: set[str] = set()

    def owner_member(pos: int) -> tuple[str | None, str | None, tuple[int, int] | None]:
        for cls in analysis.classes.values():
            if cls.file != path or not (cls.source_range[0] <= pos <= cls.source_range[1]):
                continue
            for m in cls.members.values():
                if m.start <= pos <= m.end:
                    return cls.name, m.name, (m.start, m.end)
            return cls.name, None, None
        return None, None, None

    for node, parents in walk(program):
        t = node.type
        line = node.loc.start.line if getattr(node, "loc", None) else None
        if t == "AssignmentExpression" and node.left.type == "Identifier":
            name = node.left.name
            scopes = [p for p in parents if p.type in FUNC_TYPES] or []
            if name in known_globals or name in top_decl or any(name in declared(s) for s in scopes):
                continue
            implicit.add(name)
        elif t == "ThisExpression" and not any(p.type in ("FunctionExpression", "FunctionDeclaration") for p in parents):
            edits.append((node.range[0], node.range[1], "globalThis"))
            res.findings.append(Finding("warning", "top-level-this", "`this` outside a function now refers to globalThis", file=path, line=line))
        elif t == "WithStatement":
            cls, mem, rng = owner_member(node.range[0])
            res.findings.append(Finding("error", "with-statement", "`with` is not allowed in ES modules", file=path, cls=cls, line=line))
            res.llm_targets.append({"cls": cls, "member": mem, "reason": "uses a with statement", "start": rng[0] if rng else node.range[0], "end": rng[1] if rng else node.range[1]})
        elif t == "MemberExpression" and member_chain(node) == "arguments.callee":
            cls, mem, rng = owner_member(node.range[0])
            res.findings.append(Finding("error", "arguments-callee", "arguments.callee is not allowed in strict mode", file=path, cls=cls, line=line))
            if rng:
                res.llm_targets.append({"cls": cls, "member": mem, "reason": "uses arguments.callee", "start": rng[0], "end": rng[1]})
        elif t == "Literal" and isinstance(node.value, (int, float)) and re.fullmatch(r"0[0-7]+", getattr(node, "raw", "") or ""):
            edits.append((node.range[0], node.range[1], "0o" + node.raw[1:]))
            res.findings.append(Finding("info", "octal-literal", f"legacy octal {node.raw} rewritten as 0o{node.raw[1:]}", file=path, line=line))
        elif t == "UnaryExpression" and node.operator == "delete" and node.argument.type == "Identifier":
            res.findings.append(Finding("error", "delete-identifier", "delete of a plain variable is a syntax error in strict mode", file=path, line=line))
        elif t in FUNC_TYPES:
            seen: set[str] = set()
            for p in node.params:
                for nm in _pattern_names(p):
                    if nm in seen:
                        res.findings.append(Finding("error", "duplicate-param", f"duplicate parameter {nm}", file=path, line=line))
                    seen.add(nm)
        elif t == "MemberExpression" and not (parents and parents[-1].type == "MemberExpression" and parents[-1].object is node):
            chain = member_chain(node)
            if chain and chain.startswith("Ext.") and not manifest.has_api(chain):
                # Ext.foo.Bar used as a value (class reference) or call
                cls, mem, rng = owner_member(node.range[0])
                res.findings.append(Finding("warning", "unsupported-api", f"{chain} is not implemented by the runtime", file=path, cls=cls, line=line))
                if rng:
                    res.llm_targets.append({"cls": cls, "member": mem, "reason": f"uses {chain}, which the runtime does not implement", "start": rng[0], "end": rng[1]})
        elif t == "CallExpression":
            chain = member_chain(node.callee) or ""
            if chain in ("Ext.require", "Ext.syncRequire", "Ext.Loader.setConfig", "Ext.Loader.setPath"):
                res.findings.append(Finding("info", "loader-call", f"{chain} is a no-op: modules are imported in dependency order", file=path, line=line))

    if implicit:
        names = sorted(implicit)
        res.implicit_globals = names
        res.findings.append(Finding("warning", "implicit-global", "assignment to undeclared " + ", ".join(names) +
                                    " (sloppy-mode globals); kept global through globalThis", file=path))
    # apply edits back to front
    out = text
    for s, e, rep in sorted(edits, key=lambda x: x[0], reverse=True):
        out = out[:s] + rep + out[e:]
    if implicit:
        # `x = 1` on an undeclared name created window.x; keep that contract explicitly
        decl = "\n".join(f"globalThis.{n} = globalThis.{n};" for n in sorted(implicit))
        out = decl + "\n" + _globalize(out, sorted(implicit))
    res.text = out
    return res


def _globalize(text: str, names: list[str]) -> str:
    """Rewrite bare uses of implicit globals as globalThis.<name> (outside strings / comments / properties)."""
    try:
        program = parse(text)
    except Exception:  # noqa: BLE001
        return text
    wanted = set(names)
    edits = []
    for node, parents in walk(program):
        if node.type != "Identifier" or node.name not in wanted:
            continue
        p = parents[-1] if parents else None
        if p is not None and p.type == "MemberExpression" and p.property is node and not p.computed:
            continue
        if p is not None and p.type == "Property" and p.key is node and not p.computed and not p.shorthand:
            continue
        if p is not None and p.type in ("VariableDeclarator", "FunctionDeclaration", "FunctionExpression") and getattr(p, "id", None) is node:
            continue
        edits.append((node.range[0], node.range[1], "globalThis." + node.name))
    for s, e, rep in sorted(edits, key=lambda x: x[0], reverse=True):
        text = text[:s] + rep + text[e:]
    return text


def framework_coverage(analysis: Analysis, manifest: RuntimeManifest) -> dict[str, Any]:
    """Framework classes, aliases and Ext.* APIs the app uses, split into supported and missing."""
    classes = sorted(analysis.framework_classes)
    aliases = sorted(analysis.framework_aliases)
    apis = sorted(analysis.framework_apis)
    missing_classes = [c for c in classes if not manifest.has_class(c) and not c.endswith("*")]
    missing_aliases = [a for a in aliases if not manifest.has_alias(a) and a not in analysis.aliases]
    missing_apis = [a for a in apis if not manifest.has_api(a)]
    return {
        "classes": {"used": len(classes), "missing": missing_classes},
        "aliases": {"used": len(aliases), "missing": missing_aliases},
        "apis": {"used": len(apis), "missing": missing_apis},
    }
