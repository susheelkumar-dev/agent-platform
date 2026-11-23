"""Explicit data passing between steps (LLD §29) and safe step conditions.

References::

    $steps.<step_id>.output[.field[.0.subfield]]   output of an upstream step
    $steps.<step_id>.status                        SUCCEEDED / FAILED / SKIPPED
    $request.message | $request.attachments
    $variables.<name>                              ChatRequest.variables
    $context.user_id | $context.tenant_id | $context.conversation_id
    $conversation.last_result[.field]              structured result of the previous turn

Conditions are evaluated with a whitelisted AST evaluator — never ``eval`` —
e.g. ``$steps.s1.output.total_value > 1000000 and $request.message != ''``.
"""

from __future__ import annotations

import ast
import operator
import re
from typing import Any

from ai_core.errors import ValidationError

REF_RE = re.compile(r"\$(steps|request|context|conversation|variables)((?:\.[A-Za-z0-9_\-]+)*)")
ROOTS = {"steps", "request", "context", "conversation", "variables"}
_MISSING = object()


class MappingError(ValidationError):
    default_code = "MAPPING_ERROR"


def parse_ref(ref: str) -> tuple[str, list[str]]:
    match = REF_RE.fullmatch(ref.strip())
    if not match:
        raise MappingError(f"Invalid reference '{ref}'", details={"reference": ref})
    path = [p for p in match.group(2).split(".") if p]
    return match.group(1), path


def referenced_step(ref: str) -> str | None:
    root, path = parse_ref(ref)
    return path[0] if root == "steps" and path else None


def refs_in(expression: str) -> list[str]:
    return [m.group(0) for m in REF_RE.finditer(expression)]


def _walk(value: Any, path: list[str]) -> Any:
    for part in path:
        if isinstance(value, dict):
            value = value.get(part, _MISSING)
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return _MISSING
        if value is _MISSING:
            return _MISSING
    return value


def resolve_ref(ref: str, scope: dict[str, Any], *, strict: bool = True) -> Any:
    root, path = parse_ref(ref)
    value = _walk(scope.get(root, {}), path)
    if value is _MISSING:
        if strict:
            raise MappingError(f"Reference '{ref}' could not be resolved", details={"reference": ref})
        return None
    return value


def resolve_inputs(
    static: dict[str, Any], mapping: dict[str, str], scope: dict[str, Any], *, strict: bool = True
) -> dict[str, Any]:
    result = dict(static)
    for key, ref in mapping.items():
        result[key] = resolve_ref(ref, scope, strict=strict)
    return result


# ---- safe condition evaluation -----------------------------------------------------------
_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
_CMP = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
    ast.Is: operator.is_,
    ast.IsNot: operator.is_not,
}
_FUNCS = {"len": len, "bool": bool, "int": int, "float": float, "str": str}


def _compile(expression: str) -> tuple[ast.Expression, dict[str, str]]:
    names: dict[str, str] = {}

    def repl(match: re.Match[str]) -> str:
        name = f"__r{len(names)}"
        names[name] = match.group(0)
        return name

    source = REF_RE.sub(repl, expression)
    source = source.replace("&&", " and ").replace("||", " or ")
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError as exc:
        raise MappingError(f"Invalid condition '{expression}': {exc.msg}") from exc
    for node in ast.walk(tree):
        allowed = (
            ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not, ast.USub, ast.Compare,
            ast.Name, ast.Load, ast.Constant, ast.List, ast.Tuple, ast.BinOp, ast.Call, *_BIN, *_CMP,
        )
        if not isinstance(node, allowed):
            raise MappingError(f"Condition uses a forbidden construct: {type(node).__name__}")
        if isinstance(node, ast.Name) and node.id not in names and node.id not in _FUNCS:
            raise MappingError(f"Unknown name '{node.id}' in condition")
        if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id in _FUNCS):
            raise MappingError("Only len/bool/int/float/str calls are allowed in conditions")
    return tree, names


def validate_condition(expression: str) -> list[str]:
    _, names = _compile(expression)
    return list(names.values())


def evaluate_condition(expression: str, scope: dict[str, Any]) -> bool:
    tree, names = _compile(expression)
    values = {name: resolve_ref(ref, scope, strict=False) for name, ref in names.items()}

    def ev(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return values[node.id] if node.id in values else _FUNCS[node.id]
        if isinstance(node, (ast.List, ast.Tuple)):
            return [ev(e) for e in node.elts]
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                return all(ev(v) for v in node.values)
            return any(ev(v) for v in node.values)
        if isinstance(node, ast.UnaryOp):
            operand = ev(node.operand)
            return (not operand) if isinstance(node.op, ast.Not) else -operand
        if isinstance(node, ast.BinOp):
            return _BIN[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.Call):
            return _FUNCS[node.func.id](*[ev(a) for a in node.args])  # type: ignore[attr-defined]
        if isinstance(node, ast.Compare):
            left = ev(node.left)
            for op, comparator in zip(node.ops, node.comparators, strict=True):
                right = ev(comparator)
                try:
                    if not _CMP[type(op)](left, right):
                        return False
                except TypeError:
                    return False
                left = right
            return True
        raise MappingError(f"Unsupported expression node {type(node).__name__}")

    return bool(ev(tree))
