"""Conversation memory (LLD §19, Blueprint §21).

Conversations are owned by (tenant, user). Assistant messages keep a compact
copy of the structured result so follow-ups ("now make it a bar chart") can
reuse prior data through the ``$conversation.last_result`` mapping without the
user repeating anything.
"""

from __future__ import annotations

from typing import Any

from ai_core.errors import NotFoundError
from ai_core.interfaces import ConversationStore
from ai_core.models import Message, UserContext
from ai_core.models.ops import Conversation

MAX_RESULT_ROWS = 500


def compact_result(output: dict[str, Any] | None) -> dict[str, Any] | None:
    if not output:
        return None
    out = dict(output)
    rows = out.get("rows")
    if isinstance(rows, list) and len(rows) > MAX_RESULT_ROWS:
        out["rows"] = rows[:MAX_RESULT_ROWS]
        out["truncated"] = True
    return out


class ConversationService:
    def __init__(self, store: ConversationStore, *, context_messages: int = 20) -> None:
        self.store = store
        self.context_messages = context_messages

    async def open(self, user: UserContext, conversation_id: str, first_message: str) -> Conversation:
        existing = await self.store.get(conversation_id)
        if existing is not None:
            if existing.tenant_id != user.tenant_id or existing.user_id != user.user_id:
                # Do not reveal that the conversation exists.
                raise NotFoundError("Conversation not found", code="CONVERSATION_NOT_FOUND")
            return existing
        title = first_message.strip().replace("\n", " ")[:80] or "New conversation"
        return await self.store.create(
            Conversation(
                conversation_id=conversation_id, tenant_id=user.tenant_id, user_id=user.user_id, title=title
            )
        )

    async def require(self, user: UserContext, conversation_id: str) -> Conversation:
        conv = await self.store.get(conversation_id)
        if conv is None or conv.tenant_id != user.tenant_id or conv.user_id != user.user_id:
            raise NotFoundError("Conversation not found", code="CONVERSATION_NOT_FOUND")
        return conv

    async def history(self, conversation_id: str) -> list[dict[str, Any]]:
        messages = await self.store.messages(conversation_id, limit=self.context_messages)
        return [{"role": m.role, "content": m.content} for m in messages]

    async def add_user(self, conversation_id: str, text: str, **data: Any) -> None:
        await self.store.append(conversation_id, Message(role="user", content=text, data=data))
        await self.store.touch(conversation_id)

    async def add_assistant(self, conversation_id: str, text: str, **data: Any) -> None:
        await self.store.append(conversation_id, Message(role="assistant", content=text, data=data))
        await self.store.touch(conversation_id)

    async def last_result(self, conversation_id: str) -> dict[str, Any] | None:
        for message in reversed(await self.store.messages(conversation_id, limit=self.context_messages)):
            if message.role == "assistant" and message.data.get("result"):
                return message.data["result"]
        return None

    async def list(self, user: UserContext, limit: int = 50) -> list[Conversation]:
        return await self.store.list(user.tenant_id, user.user_id, limit)

    async def messages(self, user: UserContext, conversation_id: str) -> list[Message]:
        await self.require(user, conversation_id)
        return await self.store.messages(conversation_id)

    async def delete(self, user: UserContext, conversation_id: str) -> None:
        await self.require(user, conversation_id)
        await self.store.delete(conversation_id)
