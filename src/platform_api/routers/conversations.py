from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ai_core.models import Message, UserContext
from ai_core.models.ops import Conversation
from platform_api.container import PlatformContainer
from platform_api.deps import current_user, get_container

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


@router.get("", response_model=list[Conversation])
async def list_conversations(
    user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> list[Conversation]:
    return await c.conversations.list(user)


@router.get("/{conversation_id}/messages", response_model=list[Message])
async def conversation_messages(
    conversation_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> list[Message]:
    return await c.conversations.messages(user, conversation_id)


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> dict[str, Any]:
    await c.conversations.delete(user, conversation_id)
    return {"deleted": conversation_id}
