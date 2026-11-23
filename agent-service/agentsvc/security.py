"""Caller authentication: only the BFF (shared internal key) may call the API.

The BFF authenticates the visitor and passes an opaque, stable user id in ``X-User-Id``. The service trusts that
id because only the BFF holds the key; it uses it to bind threads to their owner so one visitor cannot read or
resume another visitor's thread.
"""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings

USER_ID_RE = re.compile(r"^[A-Za-z0-9._:@-]{1,128}$")


@dataclass(frozen=True)
class Caller:
    user_id: str
    roles: tuple[str, ...]
    request_id: str | None


def require_caller(
    x_internal_api_key: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
    x_user_roles: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> Caller:
    expected = settings.internal_api_key.get_secret_value() if settings.internal_api_key else ""
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "INTERNAL_API_KEY is not configured")
    if not x_internal_api_key or not hmac.compare_digest(x_internal_api_key.encode(), expected.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid internal API key")
    if not x_user_id or not USER_ID_RE.match(x_user_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "X-User-Id is required (1-128 chars: letters, digits, ._:@-)")
    roles = tuple(r.strip() for r in (x_user_roles or "").split(",") if r.strip())[:20]
    return Caller(user_id=x_user_id, roles=roles, request_id=(x_request_id or None))
