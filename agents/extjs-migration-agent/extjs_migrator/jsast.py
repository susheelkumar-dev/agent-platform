"""Small helpers over the esprima AST (pure Python, no Node needed for analysis)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import esprima


def parse(text: str):
    """Parse a script with ranges, locations and comments; module syntax is tried if script parsing fails."""
    opts = {"range": True, "loc": True, "comment": True, "tolerant": True}
    try:
        return esprima.parseScript(text, opts)
    except esprima.Error:
        return esprima.parseModule(text, opts)


def children(node: Any) -> Iterator[Any]:
    if node is None:
        return
    for key, value in vars(node).items():
        if key in ("range", "loc", "leadingComments", "trailingComments", "innerComments"):
            continue
        if isinstance(value, list):
            for item in value:
                if hasattr(item, "type"):
                    yield item
        elif hasattr(value, "type"):
            yield value


def walk(node: Any, parents: tuple = ()) -> Iterator[tuple[Any, tuple]]:
    """Depth-first (node, parents) pairs."""
    stack = [(node, parents)]
    while stack:
        n, ps = stack.pop()
        yield n, ps
        kids = list(children(n))
        for kid in reversed(kids):
            stack.append((kid, ps + (n,)))


def member_chain(node: Any) -> str | None:
    """'Ext.data.Store' for a.b.c member expressions of identifiers; None otherwise."""
    parts = []
    while node is not None and node.type == "MemberExpression" and not node.computed:
        parts.append(node.property.name)
        node = node.object
    if node is not None and node.type == "Identifier":
        parts.append(node.name)
        return ".".join(reversed(parts))
    if node is not None and node.type == "ThisExpression":
        parts.append("this")
        return ".".join(reversed(parts))
    return None


def prop_key(prop: Any) -> str | None:
    if prop.type != "Property":
        return None
    k = prop.key
    if k.type == "Identifier" and not prop.computed:
        return k.name
    if k.type == "Literal":
        return str(k.value)
    return None


def literal(node: Any) -> Any:
    """Python value of a literal / array of literals / object of literals; raises ValueError otherwise."""
    if node is None:
        raise ValueError("none")
    t = node.type
    if t == "Literal":
        if node.regex:
            raise ValueError("regex")
        return node.value
    if t == "ArrayExpression":
        return [literal(e) for e in node.elements]
    if t == "ObjectExpression":
        out = {}
        for p in node.properties:
            k = prop_key(p)
            if k is None:
                raise ValueError("computed key")
            out[k] = literal(p.value)
        return out
    if t == "UnaryExpression" and node.operator == "-" and node.argument.type == "Literal":
        return -node.argument.value
    if t == "TemplateLiteral" and not node.expressions:
        return node.quasis[0].value.cooked
    raise ValueError(t)


def try_literal(node: Any, default: Any = None) -> Any:
    try:
        return literal(node)
    except (ValueError, AttributeError, TypeError):
        return default


def strings(node: Any) -> list[str]:
    """String or array-of-strings value (requires, alias ...)."""
    v = try_literal(node)
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return [x for x in v if isinstance(x, str)]
    return []


def value_kind(node: Any) -> str:
    t = node.type
    if t in ("FunctionExpression", "ArrowFunctionExpression"):
        return "function"
    if t == "ObjectExpression":
        return "object"
    if t == "ArrayExpression":
        return "array"
    if t == "Literal":
        v = node.value
        if node.regex:
            return "regex"
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "boolean"
        if isinstance(v, (int, float)):
            return "number"
        return "string"
    if t == "Identifier":
        return "identifier"
    return "other"


def src(text: str, node: Any) -> str:
    return text[node.range[0]: node.range[1]]
