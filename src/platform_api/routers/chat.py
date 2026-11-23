"""Chat API: synchronous, asynchronous (202 + polling/SSE) and streaming execution."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse

from ai_core.errors import PlatformError
from ai_core.models import ChatRequest, ChatResponse, UserContext, new_id
from ai_security.policy import require_permission
from platform_api.container import PlatformContainer
from platform_api.deps import current_user, get_container
from platform_api.sse import event_stream, format_event, sse_response

router = APIRouter(prefix="/api/v1", tags=["chat"])


@router.post(
    "/chat",
    response_model=ChatResponse,
    responses={202: {"description": "Accepted (mode=async): poll /executions/{id} or stream its /events"}},
    summary="Run a request through resolve → plan → validate → execute",
)
async def chat(
    request: ChatRequest, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> Any:
    if request.mode == "async":
        record = await c.chat.submit(request, user)
        return JSONResponse(
            status_code=202,
            content={
                "execution_id": record.execution_id,
                "request_id": record.request_id,
                "conversation_id": record.conversation_id,
                "status": record.status,
                "links": {
                    "self": f"/api/v1/executions/{record.execution_id}",
                    "events": f"/api/v1/executions/{record.execution_id}/events",
                    "cancel": f"/api/v1/executions/{record.execution_id}/cancel",
                },
            },
        )
    return await c.chat.handle(request, user)


@router.post("/chat/stream", summary="Run a request and stream lifecycle events (SSE)")
async def chat_stream(
    request: ChatRequest, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
):
    request.mode = "async"
    record = await c.chat.submit(request, user)

    async def stream():
        yield format_event("accepted", {"execution_id": record.execution_id, "conversation_id": record.conversation_id})
        async for chunk in event_stream(c.bus.subscribe(record.execution_id)):
            yield chunk

    return sse_response(stream())


@router.post("/chat/with-files", response_model=ChatResponse, summary="Upload documents and ask about them in one call")
async def chat_with_files(
    message: str = Form(...),
    conversation_id: str | None = Form(default=None),
    files: list[UploadFile] = File(...),
    user: UserContext = Depends(current_user),
    c: PlatformContainer = Depends(get_container),
) -> ChatResponse:
    require_permission(user, "documents.write")
    conversation_id = conversation_id or new_id()
    doc_ids = []
    for f in files:
        data = await f.read()
        doc = await c.rag.ingest(
            user, f.filename or "upload.txt", data, content_type=f.content_type or "application/octet-stream",
            knowledge_base=f"conversation:{conversation_id}",
        )
        doc_ids.append(doc.document_id)
    return await c.chat.handle(
        ChatRequest(conversation_id=conversation_id, message=message, attachments=doc_ids), user
    )


@router.post("/plans/preview", summary="Dry-run: show resolution, plan and policy decisions without executing")
async def preview_plan(
    request: ChatRequest, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> dict[str, Any]:
    resolution = await c.resolver.resolve(request, user, [])
    plan = await c.planner.create_plan(request, resolution, user)
    try:
        validated = await c.validator.validate(plan, user)
        return {
            "valid": True,
            "resolution": resolution.model_dump(mode="json"),
            "plan": validated.plan.model_dump(mode="json"),
            "execution_order": validated.execution_order,
            "policy_decisions": [d.model_dump(mode="json") for d in validated.policy_decisions],
        }
    except PlatformError as exc:
        return {
            "valid": False,
            "resolution": resolution.model_dump(mode="json"),
            "plan": plan.model_dump(mode="json"),
            "error": exc.to_info().model_dump(mode="json"),
        }
