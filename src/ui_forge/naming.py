"""Names derived from a schema: file names, identifiers, collections. Pure functions, so output is deterministic."""

from __future__ import annotations

import re

_WORD = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")

TS_RESERVED = {
    "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum",
    "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null",
    "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "as",
    "implements", "interface", "let", "package", "private", "protected", "public", "static", "yield", "any",
    "boolean", "number", "string", "symbol", "type", "from", "of", "await", "async",
}


def words(s: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(s.replace("-", " ").replace("_", " ").replace(".", " "))]


def kebab(s: str) -> str:
    return "-".join(words(s))


def pascal(s: str) -> str:
    return "".join(w[:1].upper() + w[1:] for w in words(s))


def camel(s: str) -> str:
    p = pascal(s)
    return p[:1].lower() + p[1:]


def constant(s: str) -> str:
    return "_".join(w.upper() for w in words(s))


def looks_plural(word: str) -> bool:
    """Ends in s but not ss / us / is (Address, Status and Analysis are singular), or in ies."""
    return bool(re.search(r"[^sui]s$", word, re.I) or re.search(r"ies$", word, re.I))


def plural(word: str) -> str:
    """English plural of the last word (Asset -> Assets, Entity -> Entities, Process -> Processes)."""
    if not word or looks_plural(word):
        return word
    lw = word.lower()
    if lw.endswith("sis"):
        return word[:-2] + "es"
    if re.search(r"[^aeiou]y$", lw):
        return word[:-1] + ("IES" if word.isupper() else "ies")
    if re.search(r"(s|x|z|ch|sh)$", lw):
        return word + "es"
    return word + "s"


def safe_ident(s: str) -> str:
    """A camelCase identifier that is not a reserved word."""
    c = camel(s) or "value"
    if c[0].isdigit():
        c = "_" + c
    return c + "Value" if c in TS_RESERVED else c


def collection_of(entity_name: str) -> str:
    return camel(plural(entity_name))


def entity_file(entity_name: str) -> str:
    """generation-asset"""
    return kebab(entity_name)


def display_folder(display_name: str) -> str:
    """GenerationAssetSummary -> generation-asset-summary"""
    return kebab(display_name)


def js_string(s: str) -> str:
    """A single-quoted JavaScript string literal."""
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"
