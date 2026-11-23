"""Authentication (LLD §20, Gap G16).

Pluggable authenticators produce a trusted ``UserContext``:

* ``StaticTokenAuthenticator`` — API keys / demo tokens from configuration.
  Suitable for server-to-server integration of an existing application.
* ``JWTAuthenticator`` — OIDC/JWT bearer tokens (Azure AD / Entra ID, Okta,
  Auth0, Keycloak…). RS256 via JWKS or HS256 via a shared secret, with issuer
  and audience validation. Tenant, roles and permissions come from
  configurable claims; roles expand to permissions via ``ROLE_PERMISSIONS``.

The tenant is *always* derived from the credential, never from the request
body.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from ai_core.config import Settings
from ai_core.errors import AuthenticationError
from ai_core.models import UserContext

logger = logging.getLogger("ai_security.auth")


class Authenticator(Protocol):
    name: str

    async def authenticate(self, token: str) -> UserContext | None:
        """Return a principal, None if the token is not for this authenticator, or raise."""


def expand_permissions(settings: Settings, roles: list[str], permissions: list[str]) -> list[str]:
    granted = set(permissions)
    for role in roles:
        granted.update(settings.role_permissions.get(role, []))
    if "*" in granted:
        granted.add("platform.admin")
    return sorted(granted)


class StaticTokenAuthenticator:
    name = "static"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def authenticate(self, token: str) -> UserContext | None:
        entry = self.settings.static_tokens.get(token)
        if entry is None:
            return None
        roles = list(entry.get("roles", []))
        return UserContext(
            user_id=entry.get("user_id", "service"),
            tenant_id=entry.get("tenant_id", self.settings.default_tenant),
            roles=roles,
            permissions=expand_permissions(self.settings, roles, list(entry.get("permissions", []))),
            display_name=entry.get("display_name"),
            auth_method="static",
        )


class JWTAuthenticator:
    name = "jwt"

    def __init__(self, settings: Settings) -> None:
        import jwt  # pyjwt, platform extra

        self._jwt = jwt
        self.settings = settings
        self._jwks = jwt.PyJWKClient(settings.jwt_jwks_url, cache_keys=True) if settings.jwt_jwks_url else None

    @staticmethod
    def _claim(claims: dict[str, Any], path: str) -> Any:
        value: Any = claims
        for part in path.split("."):
            if not isinstance(value, dict):
                return None
            value = value.get(part)
        return value

    @staticmethod
    def _as_list(value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return value.split()  # OAuth "scp" is space separated
        return [str(v) for v in value]

    async def authenticate(self, token: str) -> UserContext | None:
        if token.count(".") != 2:
            return None
        jwt = self._jwt
        s = self.settings
        try:
            header = jwt.get_unverified_header(token)
            alg = header.get("alg", "")
            if alg not in s.jwt_algorithms:
                raise AuthenticationError(f"JWT algorithm '{alg}' not allowed", code="JWT_ALG")
            if alg.startswith("HS"):
                if s.jwt_secret is None:
                    raise AuthenticationError("HS* JWTs are not configured", code="JWT_CONFIG")
                key: Any = s.jwt_secret.get_secret_value()
            else:
                if self._jwks is None:
                    raise AuthenticationError("JWKS URL not configured", code="JWT_CONFIG")
                key = self._jwks.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=s.jwt_audience,
                issuer=s.jwt_issuer,
                options={"verify_aud": s.jwt_audience is not None, "verify_iss": s.jwt_issuer is not None},
            )
        except AuthenticationError:
            raise
        except jwt.ExpiredSignatureError:
            raise AuthenticationError("Token expired", code="TOKEN_EXPIRED")
        except jwt.PyJWTError as exc:
            raise AuthenticationError(f"Invalid token: {exc}", code="INVALID_TOKEN")

        user_id = self._claim(claims, s.jwt_user_claim)
        if not user_id:
            raise AuthenticationError("Token has no subject", code="INVALID_TOKEN")
        tenant = self._claim(claims, s.jwt_tenant_claim) or s.default_tenant
        roles = self._as_list(self._claim(claims, s.jwt_roles_claim))
        perms = self._as_list(self._claim(claims, s.jwt_permissions_claim))
        if s.jwt_permissions_claim != "scp":
            perms += self._as_list(claims.get("scp"))
        return UserContext(
            user_id=str(user_id),
            tenant_id=str(tenant),
            roles=roles,
            permissions=expand_permissions(s, roles, perms),
            display_name=self._claim(claims, s.jwt_name_claim),
            auth_method="jwt",
        )


class AuthService:
    def __init__(self, authenticators: list[Authenticator]) -> None:
        if not authenticators:
            raise ValueError("At least one authenticator must be configured")
        self.authenticators = authenticators

    @classmethod
    def from_settings(cls, settings: Settings) -> AuthService:
        auths: list[Authenticator] = []
        for mode in settings.auth_modes:
            if mode == "jwt":
                auths.append(JWTAuthenticator(settings))
            elif mode == "static":
                auths.append(StaticTokenAuthenticator(settings))
        return cls(auths)

    async def authenticate(self, token: str | None) -> UserContext:
        if not token:
            raise AuthenticationError("Missing bearer token", code="MISSING_TOKEN")
        for auth in self.authenticators:
            principal = await auth.authenticate(token)
            if principal is not None:
                return principal
        raise AuthenticationError("Invalid bearer token", code="INVALID_TOKEN")
