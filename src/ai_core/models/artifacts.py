"""Structured UI artifacts.

Agents return *data* plus presentation instructions; clients (the bundled chat
UI, Angular, React, Teams, mobile…) decide how to render them. Artifacts are
plain dicts on the wire so new types can be added without breaking clients:
unknown types are ignored by renderers.
"""

from __future__ import annotations

from typing import Any, Literal


class Artifact:
    """Builders for the artifact types understood by the bundled renderers."""

    @staticmethod
    def text(text: str, *, title: str | None = None) -> dict[str, Any]:
        return {"type": "text", "title": title, "text": text}

    @staticmethod
    def metric(
        title: str,
        value: Any,
        *,
        format: Literal["text", "number", "currency", "percent"] = "number",
        currency: str | None = None,
        delta: float | None = None,
    ) -> dict[str, Any]:
        return {
            "type": "metric",
            "title": title,
            "value": value,
            "format": format,
            "currency": currency,
            "delta": delta,
        }

    @staticmethod
    def table(
        title: str,
        columns: list[dict[str, Any]] | list[tuple[str, str, str]],
        rows: list[dict[str, Any]],
        *,
        currency: str | None = None,
    ) -> dict[str, Any]:
        cols = [
            c if isinstance(c, dict) else {"field": c[0], "label": c[1], "data_type": c[2]} for c in columns
        ]
        return {"type": "table", "title": title, "columns": cols, "rows": rows, "currency": currency}

    @staticmethod
    def chart(
        title: str,
        data: list[dict[str, Any]],
        *,
        x: str,
        y: list[str] | str,
        chart_type: Literal["bar", "line", "pie"] = "bar",
        currency: str | None = None,
    ) -> dict[str, Any]:
        return {
            "type": "chart",
            "title": title,
            "chart_type": chart_type,
            "x": x,
            "y": [y] if isinstance(y, str) else y,
            "data": data,
            "currency": currency,
        }

    @staticmethod
    def citations(items: list[dict[str, Any]], *, title: str = "Sources") -> dict[str, Any]:
        return {"type": "citations", "title": title, "items": items}

    @staticmethod
    def approval(
        title: str, prompt: str, *, action: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Human-in-the-loop request. Clients render approve/reject buttons."""
        return {"type": "approval", "title": title, "prompt": prompt, "action": action, "payload": payload or {}}
