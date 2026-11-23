"""Inventory Agent — example application agent (owned by an application team).

Only domain behaviour lives here. Registration, routing, planning, retries,
security and telemetry come from the platform.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from ai_agent_sdk import AgentContext, AgentRequest, AgentResult, Artifact, BaseAgent, BaseTool, capability


class InventoryQuery(BaseModel):
    model_config = ConfigDict(extra="allow")
    message: str = ""
    period: str = "last_month"


class InventorySummaryTool(BaseTool):
    """Semantic tool: the only way this agent reads inventory data.

    In a real deployment this calls the ERP/ETRM API or a curated SQL view; the
    LLM never sees table names or connection strings.
    """

    name = "inventory-summary"
    description = "Returns inventory valuation rows for a period."
    permissions = ["inventory.read"]

    async def execute(self, input: dict[str, Any], context: AgentContext | None = None) -> dict[str, Any]:
        rows = [
            {"item": "Power Contract A", "commodity": "Power", "quantity": 100, "value": 250000},
            {"item": "Gas Contract B", "commodity": "Gas", "quantity": 250, "value": 420000},
            {"item": "Power Contract C", "commodity": "Power", "quantity": 150, "value": 310000},
            {"item": "Gas Contract D", "commodity": "Gas", "quantity": 200, "value": 270000},
        ]
        return {
            "period": input.get("period", "last_month"),
            "currency": "USD",
            "total_value": sum(r["value"] for r in rows),
            "items": sum(r["quantity"] for r in rows),
            "rows": rows,
        }


class InventoryAgent(BaseAgent):
    agent_id = "inventory-agent"
    name = "Inventory Agent"
    version = "1.1.0"
    description = "Inventory valuation for power and gas contracts."
    owner = "supply-team@example.com"
    capabilities = [
        capability(
            "inventory.valuation.read",
            "Inventory valuation by item and commodity",
            keywords=["inventory", "valuation", "stock", "stock value", "holdings"],
            examples=["Show inventory valuation for last month", "What is our inventory worth?"],
            input_model=InventoryQuery,
        )
    ]
    permissions = ["inventory.read"]
    timeout_seconds = 20

    def __init__(self) -> None:
        super().__init__(tools=[InventorySummaryTool()])

    def input_model_for(self, capability_name: str):
        return InventoryQuery

    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        data = await self.tools.call("inventory-summary", request.input, context)
        return AgentResult.success(
            data,
            summary=(
                f"Inventory valuation for {data['period'].replace('_', ' ')}: "
                f"{data['total_value']:,} {data['currency']} across {data['items']} units."
            ),
            artifacts=[
                Artifact.metric("Total inventory value", data["total_value"], format="currency",
                                currency=data["currency"]),
                Artifact.table(
                    "Inventory valuation details",
                    [("item", "Item", "string"), ("commodity", "Commodity", "string"),
                     ("quantity", "Quantity", "number"), ("value", "Value", "currency")],
                    data["rows"],
                    currency=data["currency"],
                ),
            ],
        )
