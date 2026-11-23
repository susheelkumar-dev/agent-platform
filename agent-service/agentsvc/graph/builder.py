"""The multi-agent graph.

    START -> router -> gridtrade_agent <-> gridtrade_tools      (GridTrade demo data; writes need approval)
                    -> migration_agent <-> migration_tools      (Ext JS -> React migration report)
                    -> general_agent                           (the platform and this portfolio lab)
    each agent -> END when it answers without calling a tool

The router asks the model for one word and falls back to keywords if the model is unavailable, so a provider
outage degrades routing instead of failing the request. Tool loops are explicit nodes (not a prebuilt agent) so
the fallback model chain from ``llm_factory`` keeps its tools bound.
"""

from __future__ import annotations

import logging
import re
from typing import Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from ..config import Settings
from ..llm_factory import chat_model
from ..tools import gridtrade, migration

logger = logging.getLogger("agentsvc.graph")

Route = Literal["gridtrade", "migration", "general"]
ANSWER_NODES = {"gridtrade_agent", "migration_agent", "general_agent"}  # only these stream tokens to the user


class AgentState(MessagesState):
    route: str


PROMPTS = {
    "gridtrade": (
        "You are the GridTrade data agent for an energy trading demo (Indian power market, prices in INR/MWh). "
        "Use the tools to look up contracts, trades, counterparties and dashboard KPIs; never invent figures. "
        "Answer in short paragraphs or a compact markdown table. Confirming a trade changes data: call "
        "confirm_trade only when the user explicitly asks; a person approves it before it runs."
    ),
    "migration": (
        "You are the migration analyst. The GridTrade app (Ext JS 7.2 classic, 101 classes) was migrated to "
        "React + TypeScript + Vite by an automated agent onto @extreact/runtime, a React implementation of the "
        "Ext JS API. Use the tools to answer from the migration report; never invent numbers. Be concise."
    ),
    "general": (
        "You are the guide to an AI engineering lab on a portfolio site. It shows: a multi-agent service "
        "(FastAPI + LangGraph, Neon PostgreSQL checkpoints, Groq/Gemini/OpenRouter fallback) behind an ASP.NET "
        "Core BFF; an Ext JS app migrated to React automatically; and displays designed with UI controls that "
        "run inside the migrated app without new code. Answer briefly. For data questions suggest asking about "
        "GridTrade contracts or trades; for migration questions, about the migration report."
    ),
}

KEYWORDS: dict[str, tuple[str, ...]] = {
    "gridtrade": ("contract", "trade", "counterpart", "dashboard", "kpi", "volume", "price", "mw", "confirm",
                  "gridtrade", "exposure", "portfolio of trades"),
    "migration": ("migrat", "ext js", "extjs", "sencha", "react", "class", "coverage", "typescript", "convert",
                  "port", "module", "@extreact"),
}


def keyword_route(text: str) -> Route:
    t = text.lower()
    scores = {r: sum(1 for k in ks if k in t) for r, ks in KEYWORDS.items()}
    best = max(scores, key=lambda r: scores[r])
    return best if scores[best] else "general"  # type: ignore[return-value]


def build_graph(settings: Settings, checkpointer: BaseCheckpointSaver | None):
    router_llm = chat_model(settings)
    gt_llm = chat_model(settings, gridtrade.TOOLS)
    mig_llm = chat_model(settings, migration.TOOLS)
    gen_llm = chat_model(settings)

    async def router(state: AgentState, config: RunnableConfig) -> dict:
        last = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
        text = str(last.content) if last else ""
        route: Route = keyword_route(text)
        try:
            reply = await router_llm.ainvoke(
                [SystemMessage("Classify the user's message. Reply with exactly one word: gridtrade (questions "
                               "about energy contracts, trades, counterparties, KPIs), migration (the Ext JS to "
                               "React migration, classes, coverage) or general (anything else)."),
                 HumanMessage(text[:1500])],
                config={**config, "tags": ["router"]},
            )
            word = re.search(r"gridtrade|migration|general", str(reply.content).lower())
            if word:
                route = word.group(0)  # type: ignore[assignment]
        except Exception as exc:  # noqa: BLE001 - routing must not fail the request
            logger.warning("router model failed, using keywords: %s", exc)
        return {"route": route}

    def agent(name: Route, llm):
        async def node(state: AgentState, config: RunnableConfig) -> dict:
            history = [m for m in state["messages"] if not isinstance(m, SystemMessage)][-24:]
            reply = await llm.ainvoke([SystemMessage(PROMPTS[name]), *history], config)
            if not isinstance(reply, AIMessage):
                reply = AIMessage(content=str(getattr(reply, "content", reply)))
            return {"messages": [reply]}

        return node

    g = StateGraph(AgentState)
    g.add_node("router", router)
    g.add_node("gridtrade_agent", agent("gridtrade", gt_llm))
    g.add_node("gridtrade_tools", ToolNode(gridtrade.TOOLS, handle_tool_errors=True))
    g.add_node("migration_agent", agent("migration", mig_llm))
    g.add_node("migration_tools", ToolNode(migration.TOOLS, handle_tool_errors=True))
    g.add_node("general_agent", agent("general", gen_llm))

    g.add_edge(START, "router")
    g.add_conditional_edges("router", lambda s: f"{s['route']}_agent",
                            ["gridtrade_agent", "migration_agent", "general_agent"])
    g.add_conditional_edges("gridtrade_agent", tools_condition, {"tools": "gridtrade_tools", END: END})
    g.add_edge("gridtrade_tools", "gridtrade_agent")
    g.add_conditional_edges("migration_agent", tools_condition, {"tools": "migration_tools", END: END})
    g.add_edge("migration_tools", "migration_agent")
    g.add_edge("general_agent", END)
    return g.compile(checkpointer=checkpointer)
