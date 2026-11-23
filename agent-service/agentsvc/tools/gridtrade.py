"""Tools over the GridTrade demo API.

Reads run straight away. Writes call ``interrupt()`` first: the graph pauses, its state is checkpointed, the
client shows an approval card, and the tool continues only when ``/resume`` brings a decision. Nothing with a side
effect runs before the interrupt, because LangGraph re-runs the tool from the top when it resumes.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
from langchain_core.tools import tool
from langgraph.types import interrupt

from ..config import get_settings


class GridTradeClient:
    """Signs in once with the service account and refreshes the token on a 401."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._lock = asyncio.Lock()
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        s = get_settings()
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=s.gridtrade_api_url.rstrip("/"), timeout=s.gridtrade_timeout_seconds)
        return self._client

    async def _login(self) -> str:
        s = get_settings()
        if s.gridtrade_password is None:
            raise RuntimeError("GRIDTRADE_PASSWORD is not configured")
        r = await self._http().post("/auth/login", json={"username": s.gridtrade_user,
                                                         "password": s.gridtrade_password.get_secret_value()})
        r.raise_for_status()
        return r.json()["data"]["token"]

    async def request(self, method: str, path: str, **kw: Any) -> Any:
        for attempt in (1, 2):
            async with self._lock:
                if self._token is None:
                    self._token = await self._login()
                token = self._token
            r = await self._http().request(method, path, headers={"Authorization": f"Bearer {token}"}, **kw)
            if r.status_code == 401 and attempt == 1:
                self._token = None
                continue
            if r.status_code >= 400:
                try:
                    message = r.json().get("message") or r.text
                except ValueError:
                    message = r.text
                raise RuntimeError(f"GridTrade API {r.status_code}: {str(message)[:300]}")
            body = r.json()
            return body.get("data", body) if isinstance(body, dict) else body
        raise RuntimeError("GridTrade API refused the service account")

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


client = GridTradeClient()


def _out(data: Any) -> str:
    """Compact JSON, capped so one tool result cannot flood the model's context."""
    text = json.dumps(data, default=str, separators=(",", ":"))
    limit = get_settings().tool_output_chars
    return text if len(text) <= limit else text[:limit] + f'... [truncated {len(text) - limit} chars]'


def _pick(rows: list[dict[str, Any]], fields: list[str]) -> list[dict[str, Any]]:
    return [{k: r.get(k) for k in fields if k in r} for r in rows]


@tool
async def gridtrade_dashboard() -> str:
    """Headline KPIs of the GridTrade book: contract counts by status, trade volumes, recent activity."""
    return _out(await client.request("GET", "/dashboard"))


@tool
async def search_contracts(status: str | None = None, counterparty: str | None = None, limit: int = 20) -> str:
    """List energy contracts. Optional filters: status (Draft, Validated or Approved), counterparty name text."""
    rows = await client.request("GET", "/contracts", params={"start": 0, "limit": 200})
    if status:
        rows = [r for r in rows if str(r.get("status", "")).lower() == status.lower()]
    if counterparty:
        rows = [r for r in rows if counterparty.lower() in str(r.get("counterpartyName", "")).lower()]
    keep = ["id", "internalRef", "name", "type", "transactionType", "status", "counterpartyName", "commodities",
            "startDate", "endDate", "contractedMw"]
    return _out({"total": len(rows), "rows": _pick(rows[: max(1, min(limit, 50))], keep)})


@tool
async def get_contract(contract_id: int) -> str:
    """Full details of one contract by its numeric id."""
    return _out(await client.request("GET", f"/contracts/{int(contract_id)}"))


@tool
async def search_trades(status: str | None = None, limit: int = 20) -> str:
    """List power trades (prices in INR/MWh). Optional filter: status (New, Confirmed, Settled or Cancelled)."""
    rows = await client.request("GET", "/trades", params={"start": 0, "limit": 200})
    if status:
        rows = [r for r in rows if str(r.get("status", "")).lower() == status.lower()]
    keep = ["id", "tradeRef", "status", "buySell", "product", "counterpartyName", "contractName", "tradeDate",
            "deliveryStart", "deliveryEnd", "volumeMw", "priceInrMwh", "notionalInr"]
    return _out({"total": len(rows), "rows": _pick(rows[: max(1, min(limit, 50))], keep)})


@tool
async def list_counterparties(limit: int = 30) -> str:
    """Counterparties (code, name, type, region, credit limit)."""
    rows = await client.request("GET", "/counterparties", params={"start": 0, "limit": 200})
    return _out(_pick(rows[: max(1, min(limit, 100))], ["id", "code", "name", "type", "region", "creditLimit"]))


@tool
async def confirm_trade(trade_id: int, reason: str = "") -> str:
    """Confirm a trade whose status is New. A person must approve this before it runs."""
    trade = await client.request("GET", f"/trades/{int(trade_id)}")  # read-only, safe to repeat on resume
    decision = interrupt({
        "kind": "approval",
        "title": f"Confirm trade {trade.get('tradeRef') or trade_id}?",
        "action": {"tool": "confirm_trade", "input": {"trade_id": int(trade_id), "reason": reason}},
        "preview": {k: trade.get(k) for k in ("tradeRef", "status", "buySell", "product", "counterpartyName",
                                              "volumeMw", "priceInrMwh", "notionalInr") if k in trade},
        "options": ["approve", "reject"],
    })
    if not isinstance(decision, dict) or decision.get("decision") != "approve":
        return "The user rejected confirming this trade. Nothing was changed."
    return _out(await client.request("POST", f"/trades/{int(trade_id)}/confirm", json={}))


READ_TOOLS = [gridtrade_dashboard, search_contracts, get_contract, search_trades, list_counterparties]
WRITE_TOOLS = [confirm_trade]
TOOLS = READ_TOOLS + WRITE_TOOLS
