"""Trading Exposure Agent — example application agent."""

from __future__ import annotations

from typing import Any

from ai_agent_sdk import AgentContext, AgentRequest, AgentResult, Artifact, BaseAgent, BaseTool, capability


class ExposureSummaryTool(BaseTool):
    name = "exposure-summary"
    description = "Returns power and gas trading exposure by book."
    permissions = ["trading.exposure.read"]

    async def execute(self, input: dict[str, Any], context: AgentContext | None = None) -> dict[str, Any]:
        rows = [
            {"book": "Gas Trading", "commodity": "Gas", "position": 1250, "exposure": 3850000},
            {"book": "Power Trading", "commodity": "Power", "position": 980, "exposure": 2740000},
            {"book": "Gas Trading", "commodity": "Gas", "position": 720, "exposure": 1960000},
            {"book": "Power Trading", "commodity": "Power", "position": 610, "exposure": 1420000},
        ]
        return {
            "as_of": "2026-09-29",
            "currency": "USD",
            "total_exposure": sum(r["exposure"] for r in rows),
            "rows": rows,
        }


class ExposureAgent(BaseAgent):
    agent_id = "exposure-agent"
    name = "Trading Exposure Agent"
    version = "1.1.0"
    description = "Power and gas trading exposure by book and commodity."
    owner = "trading-risk@example.com"
    capabilities = [
        capability(
            "trading.exposure.read",
            "Trading exposure and positions by book",
            keywords=["exposure", "position", "positions", "trading", "risk exposure", "book", "mtm"],
            examples=["Show trading exposure for today", "What are our gas and power positions?"],
        )
    ]
    permissions = ["trading.exposure.read"]
    timeout_seconds = 20

    def __init__(self) -> None:
        super().__init__(tools=[ExposureSummaryTool()])

    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        data = await self.tools.call("exposure-summary", request.input, context)
        return AgentResult.success(
            data,
            summary=(
                f"Trading exposure as of {data['as_of']}: {data['total_exposure']:,} {data['currency']} "
                f"across {len(data['rows'])} book positions."
            ),
            artifacts=[
                Artifact.metric("Total trading exposure", data["total_exposure"], format="currency",
                                currency=data["currency"]),
                Artifact.table(
                    f"Trading exposure as of {data['as_of']}",
                    [("book", "Book", "string"), ("commodity", "Commodity", "string"),
                     ("position", "Position", "number"), ("exposure", "Exposure", "currency")],
                    data["rows"],
                    currency=data["currency"],
                ),
            ],
        )
