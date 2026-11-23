"""Service-to-service integrity primitives (dependency-free, shared with the SDK).

* ``sign_request`` / ``verify_request`` — HMAC-SHA256 over ``timestamp.body``
  sent as ``X-Platform-Signature: t=<unix>,v1=<hex>``. Gives integrity and
  replay protection for platform → agent calls on top of the bearer token.
  (mTLS via a service mesh is the recommended transport hardening.)
* ``issue_context_token`` / ``verify_context_token`` — short-lived signed
  tokens carrying tenant/user/execution identity. Agents receive one per
  request and must present it when calling platform services (LLM, RAG), so
  the platform never trusts an agent-asserted tenant.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

SIGNATURE_HEADER = "X-Platform-Signature"
CONTEXT_HEADER = "X-Platform-Context"
DEFAULT_TOLERANCE_SECONDS = 300


class SignatureError(Exception):
    pass


def _hmac(secret: str, payload: bytes) -> str:
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def sign_request(secret: str, body: bytes, *, timestamp: int | None = None) -> str:
    ts = int(time.time()) if timestamp is None else timestamp
    return f"t={ts},v1={_hmac(secret, str(ts).encode() + b'.' + body)}"


def verify_request(
    secret: str, body: bytes, header: str | None, *, tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS
) -> None:
    if not header:
        raise SignatureError("missing signature")
    try:
        parts = dict(item.split("=", 1) for item in header.split(","))
        ts = int(parts["t"])
        sig = parts["v1"]
    except (KeyError, ValueError) as exc:
        raise SignatureError("malformed signature header") from exc
    if abs(time.time() - ts) > tolerance_seconds:
        raise SignatureError("signature timestamp outside tolerance")
    expected = _hmac(secret, str(ts).encode() + b"." + body)
    if not hmac.compare_digest(expected, sig):
        raise SignatureError("signature mismatch")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def issue_context_token(secret: str, claims: dict[str, Any], *, ttl_seconds: int = 900) -> str:
    body = dict(claims)
    body["exp"] = int(time.time()) + ttl_seconds
    payload = _b64(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    return f"{payload}.{_hmac(secret, payload.encode())}"


def verify_context_token(secret: str, token: str | None) -> dict[str, Any]:
    if not token or "." not in token:
        raise SignatureError("missing context token")
    payload, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(_hmac(secret, payload.encode()), sig):
        raise SignatureError("invalid context token signature")
    claims = json.loads(_unb64(payload))
    if int(claims.get("exp", 0)) < time.time():
        raise SignatureError("context token expired")
    return claims
