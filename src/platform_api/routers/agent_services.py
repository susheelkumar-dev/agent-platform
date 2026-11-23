"""Platform services exposed to agent microservices (LLM gateway, retrieval).

Authentication: the agent's registration token (Bearer) **and** the
platform-signed ``X-Platform-Context`` token it received with the request.
The tenant/user come from the signed token, never from the agent.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ai_core.errors import AuthorizationError
from ai_core.models import (
    EmbeddingRequest,
    EmbeddingResponse,
    LLMRequest,
    LLMResponse,
    RetrievalQuery,
    RetrievedChunk,
)
from ai_core.models.common import has_permissions
from platform_api.container import PlatformContainer
from platform_api.deps import AgentCaller, agent_caller, get_container

router = APIRouter(prefix="/api/v1/agent-services", tags=["agent-services"])


@router.post("/llm/generate", response_model=LLMResponse)
async def llm_generate(
    request: LLMRequest, caller: AgentCaller = Depends(agent_caller), c: PlatformContainer = Depends(get_container)
) -> LLMResponse:
    claims = caller.claims
    if request.purpose in ("router", "planner"):
        request.purpose = "agent"
    return await c.llm.generate(
        request,
        tenant_id=claims["tenant_id"],
        user_id=claims["user_id"],
        agent_id=caller.agent_id,
        request_id=claims.get("request_id"),
        execution_id=claims.get("execution_id"),
    )


@router.post("/llm/embed", response_model=EmbeddingResponse)
async def llm_embed(
    request: EmbeddingRequest, caller: AgentCaller = Depends(agent_caller),
    c: PlatformContainer = Depends(get_container),
) -> EmbeddingResponse:
    return await c.llm.embed(request, tenant_id=caller.claims["tenant_id"])


@router.post("/rag/search", response_model=list[RetrievedChunk])
async def rag_search(
    query: RetrievalQuery, caller: AgentCaller = Depends(agent_caller), c: PlatformContainer = Depends(get_container)
) -> list[RetrievedChunk]:
    if not has_permissions(caller.claims.get("permissions", []), ["documents.read"]):
        raise AuthorizationError("The user on whose behalf this agent acts lacks documents.read")
    return await c.rag.search(caller.claims["tenant_id"], query)
