"""Find the Ext JS application and every file that belongs to it.

The user can point at the application folder (the one with app.json), at its class folder (usually
``app``), or at any folder of Ext.define files. Everything is read; nothing is executed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from .model import AppInfo, SourceFile

SKIP_DIRS = {"node_modules", "build", "ext", "packages", ".sencha", ".git", "bootstrap", "temp", "dist"}
ASSET_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".csv", ".json", ".woff", ".woff2", ".ttf", ".txt", ".pdf"}


def strip_json_comments(text: str) -> str:
    """Remove // and /* */ comments outside strings (Sencha's app.json allows them)."""
    out, i, n, in_str, quote = [], 0, len(text), False, ""
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                in_str = False
        elif c in "\"'":
            in_str, quote = True, c
            out.append(c)
        elif text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
            continue
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        else:
            out.append(c)
        i += 1
    # trailing commas are common too
    import re

    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1")


def locate(path: str) -> tuple[Path, dict]:
    """Return (application root, parsed app.json or {})."""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"Path not found: {path}")
    if p.is_file():
        p = p.parent
    for candidate in (p, p.parent):
        aj = candidate / "app.json"
        if aj.is_file():
            try:
                return candidate, json.loads(strip_json_comments(read_text(aj)))
            except json.JSONDecodeError:
                return candidate, {}
    return p, {}


def _as_list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [v]
    out = []
    for item in v:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict) and item.get("path"):
            out.append(item["path"])
    return out


def discover(path: str) -> tuple[AppInfo, list[SourceFile]]:
    root, app_json = locate(path)
    info = AppInfo(root=str(root), app_json=app_json)
    if app_json:
        info.name = app_json.get("name") or info.name
        info.toolkit = app_json.get("toolkit") or ("classic" if "classic" not in app_json else "universal")
        info.theme = app_json.get("theme")
        fw = app_json.get("framework")
        info.framework_version = app_json.get("version") if fw is None else str(fw)
        info.packages = _as_list(app_json.get("requires"))
        info.classpath = _as_list(app_json.get("classpath")) or ["app"]
        info.overrides = _as_list(app_json.get("overrides"))
        sass = app_json.get("sass") or {}
        info.sass = {k: _as_list(sass.get(k)) for k in ("etc", "var", "src") if sass.get(k)}
        js = app_json.get("js") or []
        for item in js:
            p = item.get("path") if isinstance(item, dict) else item
            if p and p.endswith(".js") and "bootstrap" not in p:
                info.app_js = p
                break
    else:
        # No app.json: the given folder is the class folder itself.
        info.classpath = ["."]
    if (root / "index.html").is_file():
        info.index_html = "index.html"
    if not info.app_js and (root / "app.js").is_file():
        info.app_js = "app.js"

    files: list[SourceFile] = []
    seen: set[str] = set()

    def add(p: Path, kind: str) -> None:
        rel = p.relative_to(root).as_posix()
        if rel in seen:
            return
        seen.add(rel)
        files.append(SourceFile(path=rel, text=read_text(p) if kind != "asset" else "", kind=kind))

    def walk(folder: Path, exts: set[str], kind: str) -> None:
        if not folder.exists():
            return
        if folder.is_file():
            add(folder, kind)
            return
        for dirpath, dirnames, filenames in os.walk(folder):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
            for fn in sorted(filenames):
                if Path(fn).suffix.lower() in exts:
                    add(Path(dirpath) / fn, kind)

    for cp in info.classpath:
        walk(root / cp, {".js"}, "js")
    for ov in info.overrides:
        walk(root / ov, {".js"}, "js")
    if info.app_js:
        walk(root / info.app_js, {".js"}, "js")
    for group in info.sass.values():
        for s in group:
            walk(root / s, {".scss", ".css"}, "scss")
    if not info.sass and (root / "sass").is_dir():
        walk(root / "sass", {".scss"}, "scss")
    if info.index_html:
        add(root / info.index_html, "html")
    res = root / "resources"
    if res.is_dir():
        for dirpath, dirnames, filenames in os.walk(res):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for fn in sorted(filenames):
                p = Path(dirpath) / fn
                info.resources.append(p.relative_to(root).as_posix())
                add(p, "asset")
    return info, files
