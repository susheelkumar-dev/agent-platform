from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import uuid4


def new_id(prefix: str | None = None) -> str:
    value = uuid4().hex
    return f"{prefix}_{value}" if prefix else value


def utcnow() -> datetime:
    return datetime.now(UTC)


SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$")
AGENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
CAPABILITY_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$")
STEP_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


def semver_key(version: str) -> tuple[int, int, int, int]:
    """Sort key for semantic versions. Pre-releases sort before releases."""
    match = SEMVER_RE.match(version)
    if not match:
        return (0, 0, 0, 0)
    major, minor, patch = (int(match.group(i)) for i in (1, 2, 3))
    prerelease = 0 if "-" in version else 1
    return (major, minor, patch, prerelease)


def permission_matches(granted: str, required: str) -> bool:
    """Wildcard permission match: ``*``, ``inventory.*`` or exact."""
    if granted == "*" or granted == required:
        return True
    if granted.endswith(".*"):
        return required.startswith(granted[:-1])
    return False


def has_permissions(granted: list[str] | set[str], required: list[str] | set[str]) -> bool:
    return all(any(permission_matches(g, r) for g in granted) for r in required)


def missing_permissions(granted: list[str] | set[str], required: list[str] | set[str]) -> list[str]:
    return [r for r in required if not any(permission_matches(g, r) for g in granted)]
