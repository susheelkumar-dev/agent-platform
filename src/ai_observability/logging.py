"""Structured logging with correlation identifiers (Blueprint §34).

``request_id``, ``execution_id``, ``tenant_id`` and ``user_id`` are held in
context variables and stamped onto every log record, so a single execution can
be reconstructed from logs across the platform.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
execution_id_var: ContextVar[str | None] = ContextVar("execution_id", default=None)
tenant_id_var: ContextVar[str | None] = ContextVar("tenant_id", default=None)
user_id_var: ContextVar[str | None] = ContextVar("user_id", default=None)

_CONTEXT_VARS = {
    "request_id": request_id_var,
    "execution_id": execution_id_var,
    "tenant_id": tenant_id_var,
    "user_id": user_id_var,
}


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        for name, var in _CONTEXT_VARS.items():
            if not hasattr(record, name):
                setattr(record, name, var.get())
        return True


class JsonFormatter(logging.Formatter):
    _skip = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in self._skip and value is not None and not key.startswith("_"):
                payload[key] = value if isinstance(value, (str, int, float, bool)) else str(value)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        ids = " ".join(
            f"{k}={getattr(record, k)[:12]}" for k in ("request_id", "execution_id") if getattr(record, k, None)
        )
        return f"{base} [{ids}]" if ids else base


def configure_logging(level: str = "INFO", fmt: str = "text") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(ContextFilter())
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(TextFormatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for noisy in ("httpx", "httpcore", "aiosqlite", "sqlalchemy.engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def bind(**values: str | None) -> list[Any]:
    """Set correlation context; returns tokens for ``unbind``."""
    return [(var, var.set(values[name])) for name, var in _CONTEXT_VARS.items() if name in values]


def unbind(tokens: list[Any]) -> None:
    for var, token in reversed(tokens):
        var.reset(token)
