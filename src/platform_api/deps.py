"""FastAPI dependencies: container access, user auth, admin checks, agent (service) auth."""

from __future__ import annotations

import hmac

from fastapi import Depends, Header, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ai_core.errors import AuthenticationError
from ai_core.models import UserContext
from ai_observability.logging import tenant_id_var, user_id_var
from ai_security.policy import require_permission
from ai_security.signing import CONTEXT_HEADER, SignatureError, verify_context_token
from platform_api.container import PlatformContainer

bearer = HTTPBearer(auto_error=False, description="User token: JWT (OIDC) or a configured static API token")


def get_container(request: Request) -> PlatformContainer:
    return request.app.state.container


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
    container: PlatformContainer = Depends(get_container),
) -> UserContext:
    user = await container.auth.authenticate(credentials.credentials if credentials else None)
    tenant_id_var.set(user.tenant_id)
    user_id_var.set(user.user_id)
    return user


async def admin_user(user: UserContext = Depends(current_user)) -> UserContext:
    require_permission(user, "platform.admin")
    return user


def _check_registration_token(container: PlatformContainer, token: str | None, agent_id: str | None) -> None:
    s = container.settings
    expected = s.agent_registration_tokens.get(agent_id or "") or s.registration_token.get_secret_value()
    if not token or not hmac.compare_digest(token, expected):
        raise AuthenticationError("Invalid agent registration token", code="INVALID_REGISTRATION_TOKEN")


class AgentCaller:
    """Identity of an agent service calling back into the platform (LLM/RAG)."""

    def __init__(self, claims: dict, agent_id: str | None) -> None:
        self.claims = claims
        self.agent_id = agent_id

    @property
    def user(self) -> UserContext:
        return UserContext(
            user_id=self.claims["user_id"],
            tenant_id=self.claims["tenant_id"],
            permissions=list(self.claims.get("permissions", [])),
            auth_method="context-token",
        )


async def agent_caller(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
    context_token: str | None = Header(default=None, alias=CONTEXT_HEADER),
    agent_id: str | None = Header(default=None, alias="X-Agent-ID"),
    container: PlatformContainer = Depends(get_container),
) -> AgentCaller:
    _check_registration_token(container, credentials.credentials if credentials else None, agent_id)
    try:
        claims = verify_context_token(container.settings.signing_secret.get_secret_value(), context_token)
    except SignatureError as exc:
        raise AuthenticationError(f"Invalid platform context token: {exc}", code="INVALID_CONTEXT_TOKEN")
    return AgentCaller(claims, agent_id)


check_registration_token = _check_registration_token
