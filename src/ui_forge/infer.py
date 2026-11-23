"""Entity fields inferred from records an existing API returns (the builder's "Infer from API")."""

from __future__ import annotations

import re
from typing import Any

from .naming import words

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SKIP = {"id", "createdAt", "createdBy", "updatedAt", "updatedBy", "version", "isSystem"}


def _label(name: str) -> str:
    w = words(name)
    if w and w[-1] == "id" and len(w) > 1:
        w = w[:-1]
    return " ".join(w).capitalize() if w else name


def infer_fields(rows: list[dict[str, Any]], limit_enum: int = 8) -> list[dict[str, Any]]:
    """Field definitions (entity schema shape) for the keys of `rows`, most common types first."""
    keys: list[str] = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    out = []
    n = len(rows) or 1
    for k in keys:
        if k in SKIP or not re.match(r"^[a-z][A-Za-z0-9]{0,63}$", k):
            continue
        vals = [r.get(k) for r in rows if r.get(k) not in (None, "")]
        f: dict[str, Any] = {"name": k, "label": _label(k), "dataType": "string"}
        if not vals:
            out.append(f)
            continue
        if all(isinstance(v, bool) for v in vals):
            f["dataType"] = "boolean"
        elif all(isinstance(v, int) and not isinstance(v, bool) for v in vals):
            f["dataType"] = "integer"
            if k.endswith("Id"):
                f["description"] = "looks like a reference to another record: consider a lookup"
        elif all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals):
            f["dataType"] = "decimal"
            f["decimals"] = max(len(str(v).split(".")[1]) if "." in str(v) else 0 for v in vals)
        elif all(isinstance(v, list) for v in vals):
            items = sorted({str(x) for v in vals for x in v})
            if items and len(items) <= limit_enum * 2:
                f.update({"dataType": "enum", "multiple": True, "options": items})
        elif all(isinstance(v, str) for v in vals):
            if all(DATE.match(v) for v in vals):
                f["dataType"] = "date"
            elif all(DATETIME.match(v) for v in vals):
                f["dataType"] = "datetime"
            elif all(TIME.match(v) for v in vals):
                f["dataType"] = "time"
            else:
                distinct = sorted(set(vals))
                longest = max(len(v) for v in vals)
                if len(distinct) <= limit_enum and len(vals) >= 2 * len(distinct) and longest <= 40:
                    f.update({"dataType": "enum", "options": distinct})
                elif longest > 120:
                    f["dataType"] = "text"
                else:
                    f["maxLength"] = max(20, min(200, ((longest // 10) + 2) * 10))
        f["required"] = len(vals) == n
        f["example"] = vals[0]
        out.append(f)
    return out
