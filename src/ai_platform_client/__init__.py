"""Client for applications that *consume* the platform (your existing apps, scripts, CLIs).

    from ai_platform_client import PlatformClient

    client = PlatformClient("https://agents.example.com", token=user_jwt)
    result = client.chat("Compare inventory valuation with trading exposure")
    print(result["response"])
    for block in result["ui"]:
        ...  # metric / table / chart / citations

    for event in client.chat_stream("Show inventory valuation"):
        print(event["event_type"])

``AsyncPlatformClient`` offers the same API with ``async``/``await``.
Other languages: generate a client from ``GET /openapi.json`` (e.g. NSwag or
Kiota for .NET, openapi-generator for Java) or see ``sdk/typescript``.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import httpx


class PlatformAPIError(Exception):
    def __init__(self, status: int, body: Any) -> None:
        self.status = status
        self.body = body
        error = body.get("error", {}) if isinstance(body, dict) else {}
        self.code = error.get("code")
        super().__init__(f"HTTP {status}: {body.get('detail') if isinstance(body, dict) else body}")


def _parse_sse(lines: Iterator[str]) -> Iterator[dict[str, Any]]:
    data: list[str] = []
    for line in lines:
        if line.startswith("data: "):
            data.append(line[6:])
        elif line == "" and data:
            yield json.loads("\n".join(data))
            data = []


def _check(response: httpx.Response) -> Any:
    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = response.text
        raise PlatformAPIError(response.status_code, body)
    return response.json() if response.content else None


class PlatformClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 120.0,
                 transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport,
                                  headers={"Authorization": f"Bearer {token}"})

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> PlatformClient:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # chat / executions
    def chat(self, message: str, *, conversation_id: str | None = None, capabilities: list[str] | None = None,
             variables: dict[str, Any] | None = None, attachments: list[str] | None = None) -> dict[str, Any]:
        body = {"message": message, "capabilities": capabilities, "variables": variables or {},
                "attachments": attachments or []}
        if conversation_id:
            body["conversation_id"] = conversation_id
        return _check(self._http.post("/api/v1/chat", json=body))

    def submit(self, message: str, **kwargs: Any) -> dict[str, Any]:
        return _check(self._http.post("/api/v1/chat", json={"message": message, "mode": "async", **kwargs}))

    def chat_stream(self, message: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
        with self._http.stream("POST", "/api/v1/chat/stream", json={"message": message, **kwargs}) as r:
            if r.status_code >= 400:
                r.read()
                _check(r)
            yield from _parse_sse(r.iter_lines())

    def get_execution(self, execution_id: str) -> dict[str, Any]:
        return _check(self._http.get(f"/api/v1/executions/{execution_id}"))

    def cancel(self, execution_id: str) -> dict[str, Any]:
        return _check(self._http.post(f"/api/v1/executions/{execution_id}/cancel"))

    def preview_plan(self, message: str) -> dict[str, Any]:
        return _check(self._http.post("/api/v1/plans/preview", json={"message": message}))

    # documents
    def upload_document(self, path: str | Path, *, knowledge_base: str = "default") -> dict[str, Any]:
        p = Path(path)
        with p.open("rb") as fh:
            return _check(self._http.post("/api/v1/documents", files={"file": (p.name, fh)},
                                          data={"knowledge_base": knowledge_base}))

    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        return _check(self._http.post("/api/v1/rag/search", json={"query": query, "top_k": top_k}))

    # registry
    def list_agents(self) -> list[dict[str, Any]]:
        return _check(self._http.get("/api/v1/agents"))

    def get_agent(self, agent_id: str) -> list[dict[str, Any]]:
        return _check(self._http.get(f"/api/v1/agents/{agent_id}"))

    def list_capabilities(self) -> list[dict[str, Any]]:
        return _check(self._http.get("/api/v1/capabilities"))

    def set_agent_status(self, agent_id: str, status: str, *, version: str | None = None,
                         reason: str | None = None) -> list[dict[str, Any]]:
        params = {"version": version} if version else None
        return _check(self._http.patch(f"/api/v1/agents/{agent_id}/status", params=params,
                                       json={"status": status, "reason": reason}))

    def delete_agent(self, agent_id: str, version: str | None = None) -> dict[str, Any]:
        params = {"version": version} if version else None
        return _check(self._http.delete(f"/api/v1/agents/{agent_id}", params=params))


class AsyncPlatformClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 120.0,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._http = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport,
                                       headers={"Authorization": f"Bearer {token}"})

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> AsyncPlatformClient:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def chat(self, message: str, **kwargs: Any) -> dict[str, Any]:
        return _check(await self._http.post("/api/v1/chat", json={"message": message, **kwargs}))

    async def submit(self, message: str, **kwargs: Any) -> dict[str, Any]:
        return _check(await self._http.post("/api/v1/chat", json={"message": message, "mode": "async", **kwargs}))

    async def chat_stream(self, message: str, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        async with self._http.stream("POST", "/api/v1/chat/stream", json={"message": message, **kwargs}) as r:
            if r.status_code >= 400:
                await r.aread()
                _check(r)
            data: list[str] = []
            async for line in r.aiter_lines():
                if line.startswith("data: "):
                    data.append(line[6:])
                elif line == "" and data:
                    yield json.loads("\n".join(data))
                    data = []

    async def get_execution(self, execution_id: str) -> dict[str, Any]:
        return _check(await self._http.get(f"/api/v1/executions/{execution_id}"))

    async def cancel(self, execution_id: str) -> dict[str, Any]:
        return _check(await self._http.post(f"/api/v1/executions/{execution_id}/cancel"))

    async def list_agents(self) -> list[dict[str, Any]]:
        return _check(await self._http.get("/api/v1/agents"))


__all__ = ["AsyncPlatformClient", "PlatformAPIError", "PlatformClient"]
