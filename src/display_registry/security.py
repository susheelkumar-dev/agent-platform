"""Token validation and the application's permission catalog.

The registry trusts nothing from the request body about who the caller is: the user and their permissions come
from the application's signed JWT (issuer, audience and expiry are checked). Permission names in a manifest are
checked against the catalog the application publishes, fetched with the caller's own token.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt

from .settings import AppConfig


class AuthError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Principal:
    user: str
    permissions: frozenset[str]
    token: str = field(repr=False)

    def has(self, *perms: str) -> bool:
        return all(p in self.permissions for p in perms)


_jwks_clients: dict[str, Any] = {}


def verify_token(app: AppConfig, authorization: str | None) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError(401, "Sign in required: send Authorization: Bearer <token>")
    token = authorization.split(" ", 1)[1].strip()
    try:
        if app.jwks_url:
            client = _jwks_clients.setdefault(app.jwks_url, jwt.PyJWKClient(app.jwks_url, cache_keys=True))
            key: Any = client.get_signing_key_from_jwt(token).key
        else:
            key = app.secret()
            if not key:
                raise AuthError(500, f"The registry has no signing secret for this app (set {app.secret_env})")
        claims = jwt.decode(token, key=key, algorithms=app.algorithms, audience=app.audience, issuer=app.issuer,
                            options={"require": ["exp", "iss", "aud"]})
    except jwt.ExpiredSignatureError:
        raise AuthError(401, "Session expired: sign in again")
    except jwt.InvalidTokenError as e:
        raise AuthError(401, f"Invalid token: {e}")
    user = claims.get(app.user_claim)
    if not user:
        raise AuthError(401, f"Token has no '{app.user_claim}' claim")
    perms = claims.get(app.permissions_claim) or []
    if isinstance(perms, str):
        perms = perms.split()
    return Principal(user=str(user), permissions=frozenset(str(p) for p in perms), token=token)


def parse_catalog(body: Any) -> set[str]:
    """Accepts a list of names, {"permissions": [...]}, {"data": ...} envelopes, or [{module, actions}] groups."""
    if isinstance(body, dict):
        if "data" in body:
            return parse_catalog(body["data"])
        if "permissions" in body:
            return parse_catalog(body["permissions"])
        raise ValueError("unrecognised permission catalog")
    out: set[str] = set()
    for item in body or []:
        if isinstance(item, str):
            out.add(item)
        elif isinstance(item, dict) and "module" in item and "actions" in item:
            out.update(f"{item['module']}.{a}" for a in item["actions"])
        elif isinstance(item, dict) and "name" in item:
            out.add(str(item["name"]))
        else:
            raise ValueError("unrecognised permission catalog entry")
    return out


class CatalogCache:
    def __init__(self, ttl_seconds: float, timeout_seconds: float) -> None:
        self.ttl = ttl_seconds
        self.timeout = timeout_seconds
        self._cache: dict[str, tuple[float, set[str]]] = {}

    async def get(self, app_id: str, app: AppConfig, principal: Principal) -> set[str] | None:
        """The app's permission names, or None when the app publishes no catalog."""
        if not app.permission_catalog_url:
            return None
        hit = self._cache.get(app_id)
        if hit and time.monotonic() - hit[0] < self.ttl:
            return hit[1]
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(app.permission_catalog_url, headers={"Authorization": f"Bearer {principal.token}"})
            r.raise_for_status()
            names = parse_catalog(r.json())
        except Exception as e:  # unreachable, refused or malformed: fail closed
            raise AuthError(503, f"Cannot read the application's permission catalog ({app.permission_catalog_url}): {e}")
        self._cache[app_id] = (time.monotonic(), names)
        return names

    def clear(self) -> None:
        self._cache.clear()
