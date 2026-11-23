"""Sencha theme SCSS -> standard SCSS + CSS variables for the runtime theme.

Sencha Fashion adds `dynamic()` and the theme's variables. The output keeps the app's own SCSS (compiled by
Vite's sass), strips `dynamic()`, turns the Ext theme variables it knows into CSS custom properties read by
the runtime theme (--ext-base-color ...), and reports Ext-only mixins and functions it had to drop.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .model import Finding, SourceFile

# Ext theme variable -> runtime CSS variable
EXT_VARS = {
    "base-color": "--ext-base-color",
    "font-family": "--ext-font-family",
    "font-size": "--ext-font-size",
    "grid-row-cell-font-size": "--ext-grid-row-cell-font-size",
    "color": "--ext-color",
    "neutral-color": "--ext-neutral",
    "form-field-invalid-border-color": "--ext-invalid",
    "grid-row-cell-selected-background-color": "--ext-selected-row",
    "grid-row-cell-over-background-color": "--ext-over-row",
    "grid-row-cell-alt-background-color": "--ext-alt-row",
    "panel-body-border-color": "--ext-border-color",
}
DYNAMIC_RE = re.compile(r"dynamic\(\s*(.*?)\s*\)\s*(;|!default)", re.S)
VAR_DECL_RE = re.compile(r"^\s*\$([\w-]+)\s*:\s*(.+?)\s*(!default)?\s*;", re.M)
EXT_INCLUDE_RE = re.compile(r"^\s*@include\s+(extjs-[\w-]+|x-[\w-]+)\b[^;{]*(\{[^}]*\}|;)", re.M)
SENCHA_FUNCS = ("theme-background-image", "get-resource-path", "font-icon", "icon(")


@dataclass
class StyleResult:
    theme_css: str = ""
    app_scss: str = ""
    findings: list[Finding] = field(default_factory=list)


def _strip_dynamic(text: str) -> str:
    return DYNAMIC_RE.sub(lambda m: m.group(1) + (";" if m.group(2) == ";" else " !default"), text)


def convert(files: list[SourceFile], sass_groups: dict[str, list[str]]) -> StyleResult:
    res = StyleResult()
    scss = [f for f in files if f.kind == "scss"]
    if not scss:
        return res

    def group_of(path: str) -> str:
        for g, roots in sass_groups.items():
            if any(path == r or path.startswith(r.rstrip("/") + "/") for r in roots):
                return g
        name = path.rsplit("/", 1)[-1]
        if name.startswith("var") or "/var/" in path:
            return "var"
        if "/etc/" in path:
            return "etc"
        return "src"

    ordered = sorted(scss, key=lambda f: ({"var": 0, "etc": 1, "src": 2}[group_of(f.path)], f.path))
    css_vars: dict[str, str] = {}
    parts: list[str] = []
    for f in ordered:
        text = _strip_dynamic(f.text)
        for m in VAR_DECL_RE.finditer(text):
            name, value = m.group(1), m.group(2).strip()
            if name in EXT_VARS and "$" not in value:
                css_vars[EXT_VARS[name]] = value
        dropped = EXT_INCLUDE_RE.findall(text)
        if dropped:
            text = EXT_INCLUDE_RE.sub("", text)
            res.findings.append(Finding("warning", "sass-ext-mixin", "removed Ext theme mixins: " + ", ".join(sorted({d[0] for d in dropped})) +
                                        " (restyle with plain CSS against the x-* classes)", file=f.path))
        for fn in SENCHA_FUNCS:
            if fn in text:
                res.findings.append(Finding("warning", "sass-ext-function", f"uses Sencha function {fn.rstrip('(')}; replace with a url() / plain value", file=f.path))
        # Ext variables the app reads but does not declare would be undefined under plain sass
        parts.append(f"/* ---- {f.path} ({group_of(f.path)}) ---- */\n{text.strip()}\n")
    declared = set(m.group(1) for f in ordered for m in VAR_DECL_RE.finditer(_strip_dynamic(f.text)))
    used = set(re.findall(r"\$([\w-]+)", "\n".join(parts)))
    undeclared = sorted(u for u in used - declared if u in EXT_VARS)
    prelude = "".join(f"${u}: var({EXT_VARS[u]});\n" for u in undeclared)
    others = sorted(u for u in used - declared - set(EXT_VARS))
    if others:
        res.findings.append(Finding("warning", "sass-undeclared", "Ext theme variables used but not available: " + ", ".join("$" + o for o in others) +
                                    " (declare them in src/styles/app.scss)"))
        prelude += "".join(f"${o}: null !default;\n" for o in others)
    res.app_scss = "// Generated from the Ext JS app's sass by extjs-migration-agent. Plain SCSS, compiled by Vite.\n" + prelude + "\n".join(parts)
    lines = [f"  {k}: {v};" for k, v in sorted(css_vars.items())]
    res.theme_css = "/* Theme variables taken from the Ext JS app (sass var files). */\n:root {\n" + "\n".join(lines) + "\n}\n"
    return res
