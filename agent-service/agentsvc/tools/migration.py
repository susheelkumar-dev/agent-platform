"""Tools over the GridTrade Ext JS -> React migration report bundled with the service (data/migration-report.json).

The migration itself runs where the source code is (the extjs-migrate CLI); the hosted agent explains its result.
"""

from __future__ import annotations

import json
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

from langchain_core.tools import tool

from ..config import get_settings


@lru_cache
def report() -> dict[str, Any]:
    path = Path(get_settings().migration_report_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    return json.loads(path.read_text(encoding="utf-8"))


def _out(data: Any) -> str:
    text = json.dumps(data, default=str, separators=(",", ":"))
    limit = get_settings().tool_output_chars
    return text if len(text) <= limit else text[:limit] + "... [truncated]"


@tool
def migration_summary() -> str:
    """Overall result of the GridTrade Ext JS to React migration: classes, modules, categories, coverage, build."""
    r = report()
    verify = r.get("verify") or {}
    return _out({
        "app": r.get("app"), "shell": r.get("shell"), "summary": r.get("summary"),
        "coverage": {k: {"used": v.get("used"), "missing": len(v.get("missing", []))}
                     for k, v in (r.get("coverage") or {}).items()},
        "build": {s.get("name"): s.get("ok") for s in verify.get("steps", [])} if isinstance(verify, dict) else verify,
        "typecheckRelaxed": r.get("typecheckRelaxed"),
        "nextSteps": r.get("nextSteps"),
    })


@tool
def list_migrated_classes(category: str | None = None, limit: int = 40) -> str:
    """Ext JS classes that were migrated, optionally for one category (view, controller, model, store, ...)."""
    classes = report().get("classes") or []
    if category:
        classes = [c for c in classes if str(c.get("category", "")).lower() == category.lower()]
    counts = Counter(c.get("category") for c in report().get("classes") or [])
    rows = [{k: c.get(k) for k in ("name", "category", "frameworkBase", "module")} for c in classes[: max(1, min(limit, 120))]]
    return _out({"countsByCategory": dict(counts), "total": len(classes), "rows": rows})


@tool
def migrated_class_details(name: str) -> str:
    """Where one Ext JS class (e.g. GT.view.contract.ContractGrid) came from and which React module it became."""
    matches = [c for c in report().get("classes") or [] if name.lower() in str(c.get("name", "")).lower()]
    return _out(matches[:5] or {"message": f"No migrated class matches '{name}'"})


@tool
def framework_coverage() -> str:
    """Which Ext JS framework classes, aliases and APIs the app uses, and any the React runtime does not cover."""
    return _out(report().get("coverage") or {})


TOOLS = [migration_summary, list_migrated_classes, migrated_class_details, framework_coverage]
