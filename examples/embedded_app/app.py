"""Embedding the platform inside an EXISTING FastAPI application.

Scenario: an organization already runs an "orders" service. They mount the
agent platform at /ai, register one in-process agent that reuses their own
service layer, and keep using independently deployed agents for everything else.

    uvicorn examples.embedded_app.app:app --port 9000
    open http://127.0.0.1:9000/ai/
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from ai_agent_sdk import AgentResult, Artifact, BaseAgent, capability
from ai_core.config import Settings
from platform_api import create_app


# ---- the existing application's own code -------------------------------------------------
class OrderService:
    async def open_orders(self, tenant_id: str) -> list[dict]:
        return [
            {"order_id": "SO-1001", "customer": "Contoso", "status": "open", "amount": 12500},
            {"order_id": "SO-1002", "customer": "Fabrikam", "status": "open", "amount": 8400},
        ]


orders = OrderService()


# ---- an in-process agent that reuses that code (no network hop) --------------------------
class OrdersAgent(BaseAgent):
    agent_id = "orders-agent"
    name = "Orders Agent"
    version = "1.0.0"
    description = "Open sales orders from the host application."
    capabilities = [capability("sales.orders.read", "Open sales orders",
                               keywords=["order", "orders", "sales order", "backlog"],
                               examples=["Show my open orders"])]

    async def execute(self, request, context):
        rows = await orders.open_orders(context.tenant_id)
        total = sum(r["amount"] for r in rows)
        return AgentResult.success(
            {"rows": rows, "total_amount": total, "currency": "USD"},
            summary=f"{len(rows)} open orders worth {total:,} USD.",
            artifacts=[Artifact.table("Open orders", [("order_id", "Order", "string"),
                                                      ("customer", "Customer", "string"),
                                                      ("amount", "Amount", "currency")], rows, currency="USD")],
        )


# ---- wiring ----------------------------------------------------------------------------------
ai = create_app(Settings(database_url="sqlite+aiosqlite:///./data/embedded.db"), local_agents=[OrdersAgent()])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Mounted sub-applications do not get lifespan events from Starlette; run the platform's explicitly.
    async with ai.router.lifespan_context(ai):
        yield


app = FastAPI(title="Existing Orders Service", lifespan=lifespan)


@app.get("/orders")
async def list_orders():
    return await orders.open_orders("default")


app.mount("/ai", ai)
