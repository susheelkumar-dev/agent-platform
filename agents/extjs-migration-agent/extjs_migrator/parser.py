"""Extract Ext.define / Ext.application declarations from source files."""

from __future__ import annotations

from .jsast import member_chain, parse, prop_key, src, strings, try_literal, value_kind, walk
from .model import ExtClass, Finding, Member, SourceFile

DEFINE_CALLEES = {"Ext.define"}
APP_CALLEES = {"Ext.application"}


def _uses_call_parent(fn_node) -> bool:
    for n, _ in walk(fn_node.body):
        if n.type == "CallExpression" and n.callee.type == "MemberExpression" and not n.callee.computed:
            if n.callee.property.name in ("callParent", "callSuper"):
                return True
    return False


def _members(text: str, obj) -> dict[str, Member]:
    out: dict[str, Member] = {}
    for p in obj.properties:
        key = prop_key(p)
        if key is None:
            continue
        v = p.value
        kind = value_kind(v)
        out[key] = Member(
            name=key, kind=kind, source=src(text, v), node=v, start=v.range[0], end=v.range[1],
            calls_parent=kind == "function" and _uses_call_parent(v),
        )
    return out


def _doc_before(text: str, comments, start: int) -> str:
    best = None
    for c in comments or []:
        if c.type == "Block" and c.range[1] <= start and text[c.range[1]:start].strip() == "":
            best = c
    if best is None:
        return ""
    lines = [ln.strip().lstrip("*").strip() for ln in best.value.strip("*").splitlines()]
    return "\n".join(ln for ln in lines if ln).strip()


def _fill(cls: ExtClass, members: dict[str, Member]) -> None:
    m = members
    if "extend" in m:
        ext = try_literal(m["extend"].node)
        cls.extend = ext if isinstance(ext, str) else None
    if "override" in m:
        ov = try_literal(m["override"].node)
        cls.override = ov if isinstance(ov, str) else None
        cls.kind = "override"
    aliases = strings(m["alias"].node) if "alias" in m else []
    xtypes = strings(m["xtype"].node) if "xtype" in m else []
    cls.alias = aliases + [f"widget.{x}" for x in xtypes if f"widget.{x}" not in aliases]
    if "alternateClassName" in m:
        cls.alternate_names = strings(m["alternateClassName"].node)
    if "requires" in m:
        cls.requires = strings(m["requires"].node)
    if "uses" in m:
        cls.uses = strings(m["uses"].node)
    if "mixins" in m:
        node = m["mixins"].node
        if node.type == "ArrayExpression":
            cls.mixins = strings(node)
        elif node.type == "ObjectExpression":
            cls.mixins = [x for x in (try_literal(p.value) for p in node.properties) if isinstance(x, str)]
    if "singleton" in m:
        cls.singleton = try_literal(m["singleton"].node) is True


def parse_file(sf: SourceFile, findings: list[Finding]) -> list[ExtClass]:
    try:
        program = parse(sf.text)
    except Exception as e:  # esprima.Error and friends
        sf.parse_error = str(e)
        findings.append(Finding("error", "parse-error", f"Could not parse: {e}", file=sf.path))
        return []
    comments = getattr(program, "comments", None)
    classes: list[ExtClass] = []
    claimed: list[tuple[int, int]] = []
    for node, _parents in walk(program):
        if node.type != "CallExpression":
            continue
        callee = member_chain(node.callee)
        if callee in DEFINE_CALLEES and node.arguments:
            name = try_literal(node.arguments[0])
            body = node.arguments[1] if len(node.arguments) > 1 else None
            if not isinstance(name, str) or body is None:
                findings.append(Finding("warning", "dynamic-define", "Ext.define with a computed name or body",
                                        file=sf.path, line=node.loc.start.line))
                continue
            if body.type in ("FunctionExpression", "ArrowFunctionExpression"):
                # Ext.define('X', function (X) { return {...}; })
                ret = None
                for n, _ in walk(body.body):
                    if n.type == "ReturnStatement" and n.argument is not None and n.argument.type == "ObjectExpression":
                        ret = n.argument
                        break
                if ret is None:
                    findings.append(Finding("warning", "function-define", f"{name}: body function without an object return",
                                            file=sf.path, line=node.loc.start.line))
                    continue
                body = ret
            if body.type != "ObjectExpression":
                continue
            cls = ExtClass(name=name, file=sf.path, source_range=(node.range[0], node.range[1]))
            cls.members = _members(sf.text, body)
            cls.doc = _doc_before(sf.text, comments, node.range[0])
            _fill(cls, cls.members)
            if len(node.arguments) > 2:
                findings.append(Finding("info", "define-callback", f"{name}: Ext.define callback (runs after creation)",
                                        file=sf.path, cls=name))
                cls.members["$createdFn"] = Member("$createdFn", "function", src(sf.text, node.arguments[2]),
                                                   node.arguments[2], *node.arguments[2].range)
            classes.append(cls)
            claimed.append(tuple(node.range))
        elif callee in APP_CALLEES and node.arguments and node.arguments[0].type == "ObjectExpression":
            body = node.arguments[0]
            members = _members(sf.text, body)
            app_name = try_literal(members["name"].node) if "name" in members else None
            cls = ExtClass(name=f"{app_name or 'App'}.$application", file=sf.path, kind="application",
                           source_range=tuple(node.range))
            cls.members = members
            _fill(cls, members)
            cls.category = "app"
            classes.append(cls)
            claimed.append(tuple(node.range))
    # Anything at top level that is not part of a define: keep a note (the generator copies it as is).
    for stmt in program.body:
        r = tuple(stmt.range)
        if not any(a <= r[0] and r[1] <= b for a, b in claimed) and not any(r[0] <= a and b <= r[1] for a, b in claimed):
            sf.top_level_other.append(src(sf.text, stmt))
        elif any(r[0] <= a and b <= r[1] for a, b in claimed) and stmt.type != "ExpressionStatement":
            sf.top_level_other.append(src(sf.text, stmt))
    sf.classes = [c.name for c in classes]
    return classes
