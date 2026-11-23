"""Documents / knowledge-base API (LLD §22) and user-facing retrieval."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile

from ai_core.models import DocumentRef, RetrievalQuery, RetrievedChunk, UserContext
from ai_security.policy import require_permission
from platform_api.container import PlatformContainer
from platform_api.deps import current_user, get_container

router = APIRouter(prefix="/api/v1", tags=["documents"])


@router.post("/documents", response_model=DocumentRef, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    knowledge_base: str = Form(default="default"),
    wait: bool = Form(default=True, description="false = ingest in the background and poll status"),
    user: UserContext = Depends(current_user),
    c: PlatformContainer = Depends(get_container),
) -> DocumentRef:
    require_permission(user, "documents.write")
    data = await file.read()
    return await c.rag.ingest(
        user, file.filename or "upload.txt", data,
        content_type=file.content_type or "application/octet-stream",
        knowledge_base=knowledge_base, wait=wait,
    )


@router.get("/documents", response_model=list[DocumentRef])
async def list_documents(
    knowledge_base: str | None = None,
    user: UserContext = Depends(current_user),
    c: PlatformContainer = Depends(get_container),
) -> list[DocumentRef]:
    require_permission(user, "documents.read")
    return await c.document_store.list(user.tenant_id, knowledge_base)


@router.get("/documents/{document_id}", response_model=DocumentRef)
async def get_document(
    document_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> DocumentRef:
    require_permission(user, "documents.read")
    return await c.rag.get_document(user, document_id)


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> dict[str, Any]:
    require_permission(user, "documents.write")
    await c.rag.delete_document(user, document_id)
    return {"deleted": document_id}


@router.post("/rag/search", response_model=list[RetrievedChunk])
async def search(
    query: RetrievalQuery, user: UserContext = Depends(current_user), c: PlatformContainer = Depends(get_container)
) -> list[RetrievedChunk]:
    require_permission(user, "documents.read")
    return await c.rag.search(user.tenant_id, query)
