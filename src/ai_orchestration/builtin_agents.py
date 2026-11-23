"""Built-in platform agents (run in-process via LocalAgentRuntime).

They are generic — no domain knowledge — and give every organization useful
behaviour out of the box: cross-agent comparison, charting of any tabular
result, grounded document Q&A, and a helpful fallback.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import Any

from ai_agents.base import BaseAgent, capability
from ai_core.errors import LLMError
from ai_core.models import AgentContext, AgentRequest, AgentResult, Artifact
from ai_llm.prompts import GENERAL_CHAT as GENERAL_PROMPT
from ai_llm.prompts import RAG_ANSWER
from ai_orchestration.resolver import AGGREGATE, CHART, DOCUMENT_ANSWER, GENERAL_CHAT

PLATFORM_VERSION = "2.0.0"


def _humanize(name: str) -> str:
    return re.sub(r"[_\-.]+", " ", name).strip().capitalize()


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def extract_rows(dataset: Any) -> list[dict[str, Any]]:
    if isinstance(dataset, list):
        return [r for r in dataset if isinstance(r, dict)]
    if isinstance(dataset, dict):
        for key in ("rows", "comparison", "items", "data", "records"):
            value = dataset.get(key)
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return value
        for value in dataset.values():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return value
    return []


def primary_measure(output: dict[str, Any], rows: list[dict[str, Any]]) -> str | None:
    numeric = [k for k in (rows[0] if rows else {}) if all(_is_number(r.get(k)) for r in rows if k in r)]
    for key in output:
        if key.startswith("total_") and key[6:] in numeric:
            return key[6:]
    for preferred in ("value", "amount", "total", "exposure", "revenue", "cost"):
        if preferred in numeric:
            return preferred
    return numeric[-1] if numeric else None


def headline(output: dict[str, Any]) -> tuple[str, float] | None:
    for key, value in output.items():
        if key.startswith("total") and _is_number(value):
            return key, value
    return None


class AggregateAgent(BaseAgent):
    agent_id = "platform-aggregator"
    name = "Result Aggregator"
    version = PLATFORM_VERSION
    description = "Combines and compares the results of several agents."
    capabilities = [capability(AGGREGATE, "Combine/compare results of parallel steps", internal=True)]
    owner = "platform"

    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        sources = request.input.get("sources", [])
        present: list[tuple[dict, dict]] = []
        missing: list[str] = []
        for src in sources:
            out = request.input.get(src["step_id"])
            label = _humanize(src.get("agent_id") or src["capability"]).replace(" agent", "")
            src = {**src, "label": label}
            if isinstance(out, dict):
                present.append((src, out))
            else:
                missing.append(label)

        totals_rows = []
        currency = None
        for src, out in present:
            hl = headline(out)
            if hl:
                currency = currency or out.get("currency")
                totals_rows.append({"source": src["label"], "metric": _humanize(hl[0]), "value": hl[1]})

        # Generic breakdown on a shared categorical dimension (e.g. "commodity", "region").
        breakdown_rows: list[dict[str, Any]] = []
        dimension = None
        measures: list[str] = []
        tables = [(src, out, extract_rows(out)) for src, out in present]
        tables = [t for t in tables if t[2]]
        if len(tables) >= 2:
            shared = set.intersection(
                *[{k for k, v in rows[0].items() if isinstance(v, str)} for _, _, rows in tables]
            )
            if shared:
                dimension = sorted(shared, key=lambda k: (k not in ("commodity", "category", "region", "type"), k))[0]
                grid: OrderedDict[str, dict[str, Any]] = OrderedDict()
                for src, out, rows in tables:
                    measure = primary_measure(out, rows)
                    if not measure:
                        continue
                    label = src["label"]
                    column = label if measure.lower() in label.lower() else f"{label} {measure}"
                    col_key = re.sub(r"\W+", "_", column.lower())
                    measures.append(col_key)
                    for row in rows:
                        key = str(row.get(dimension))
                        entry = grid.setdefault(key, {dimension: key})
                        entry[col_key] = entry.get(col_key, 0) + (row.get(measure) or 0)
                breakdown_rows = list(grid.values())

        parts = []
        for src, out in present:
            parts.append(out.get("summary") or f"{src['label']}: result available.")
        if len(totals_rows) == 2 and totals_rows[1]["value"]:
            a, b = totals_rows
            ratio = a["value"] / b["value"]
            parts.append(
                f"{a['source']} ({a['value']:,.0f}) is {ratio:.2f}× {b['source']} ({b['value']:,.0f}); "
                f"difference {a['value'] - b['value']:,.0f}{' ' + currency if currency else ''}."
            )
        if missing:
            parts.append(f"Not available: {', '.join(missing)}.")

        artifacts = []
        if totals_rows:
            artifacts.append(Artifact.table("Comparison of totals", [
                ("source", "Source", "string"), ("metric", "Metric", "string"), ("value", "Value", "currency"),
            ], totals_rows, currency=currency))
        if breakdown_rows and dimension:
            cols = [(dimension, _humanize(dimension), "string")] + [
                (m, _humanize(m), "currency") for m in measures
            ]
            artifacts.append(Artifact.table(f"Comparison by {dimension}", cols, breakdown_rows, currency=currency))
            artifacts.append(Artifact.chart(f"Comparison by {dimension}", breakdown_rows, x=dimension, y=measures,
                                            currency=currency))
        return AgentResult.success(
            {
                "comparison": breakdown_rows or totals_rows,
                "rows": breakdown_rows or totals_rows,
                "totals": totals_rows,
                "dimension": dimension,
                "currency": currency,
                "missing_sources": missing,
            },
            summary=" ".join(parts),
            artifacts=artifacts,
        )


class ChartAgent(BaseAgent):
    agent_id = "platform-chart"
    name = "Chart Builder"
    version = PLATFORM_VERSION
    description = "Builds a structured chart specification from any tabular result."
    capabilities = [
        capability(
            CHART,
            "Visualize tabular data as a bar, line or pie chart",
            keywords=["chart", "graph", "plot", "visualize", "visualise", "visualization", "bar chart",
                      "line chart", "pie chart", "histogram"],
            examples=["Now make it a bar chart", "Plot this as a line chart"],
        )
    ]
    owner = "platform"

    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        dataset = request.input.get("dataset")
        rows = extract_rows(dataset)
        if not rows:
            return AgentResult.failure(
                "There is no tabular data to chart. Ask for some data first, e.g. a report.",
                code="NO_DATA",
            )
        output = dataset if isinstance(dataset, dict) else {}
        text = str(request.input.get("message", "")).lower()
        chart_type = "line" if "line" in text else "pie" if "pie" in text else "bar"
        first = rows[0]
        x = next((k for k, v in first.items() if isinstance(v, str)), None)
        numeric = [k for k, v in first.items() if _is_number(v)]
        if x is None or not numeric:
            return AgentResult.failure("The data has no category/number columns to chart.", code="NOT_CHARTABLE")
        if output.get("comparison") and len(numeric) > 1:
            ys = numeric
        else:
            measure = primary_measure(output, rows) or numeric[-1]
            ys = [measure]
        grouped: OrderedDict[str, dict[str, Any]] = OrderedDict()
        for row in rows:
            key = str(row.get(x))
            entry = grouped.setdefault(key, {x: key, **{y: 0 for y in ys}})
            for y in ys:
                entry[y] += row.get(y) or 0
        data = list(grouped.values())
        title = f"{', '.join(_humanize(y) for y in ys)} by {_humanize(x).lower()}"
        currency = output.get("currency")
        return AgentResult.success(
            {"chart_type": chart_type, "x": x, "y": ys, "data": data, "dataset": output or {"rows": rows}},
            summary=f"Here is a {chart_type} chart of {title.lower()}.",
            artifacts=[Artifact.chart(title, data, x=x, y=ys, chart_type=chart_type, currency=currency)],
        )


class DocumentAnswerAgent(BaseAgent):
    agent_id = "platform-documents"
    name = "Document Q&A"
    version = PLATFORM_VERSION
    description = "Answers questions grounded in uploaded documents, with citations."
    capabilities = [
        capability(
            DOCUMENT_ANSWER,
            "Answer questions from uploaded documents and knowledge bases",
            keywords=["document", "uploaded", "attachment", "pdf", "handbook", "manual", "knowledge base",
                      "according to", "policy document", "the file"],
            examples=["What does the uploaded policy say about leave approval?"],
            permissions=["documents.read"],
        )
    ]
    owner = "platform"

    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        question = str(request.input.get("message", ""))
        doc_ids = request.input.get("document_ids") or None
        kb = request.input.get("knowledge_base")
        assert self.platform is not None, "platform services not injected"
        chunks = await self.platform.search(context, question, top_k=5, document_ids=doc_ids, knowledge_base=kb)
        if not chunks:
            return AgentResult.success(
                {"answer": None, "sources": []},
                summary="I couldn't find any relevant content in your documents. Upload a document or "
                "attach one to your question.",
            )
        sources = "\n\n".join(f"[{i + 1}] ({c.filename}, p.{c.page or '-'}) {c.text}" for i, c in enumerate(chunks))
        try:
            response = await self.platform.generate(
                context,
                RAG_ANSWER.render(sources=sources, question=question),
                purpose="rag",
                metadata={"query": question, "contexts": [c.text for c in chunks]},
            )
            answer = response.content.strip()
        except LLMError as exc:
            return AgentResult.failure(f"Language model unavailable: {exc.message}", code="LLM_UNAVAILABLE",
                                       retryable=exc.retryable, category="LLM")
        cites = [
            {"index": i + 1, "document_id": c.document_id, "filename": c.filename, "page": c.page,
             "chunk_id": c.chunk_id, "score": c.score, "snippet": c.text[:280]}
            for i, c in enumerate(chunks)
        ]
        return AgentResult.success(
            {"answer": answer, "sources": cites},
            summary=answer,
            citations=cites,
            artifacts=[Artifact.citations(cites)],
        )


class GeneralChatAgent(BaseAgent):
    agent_id = "platform-general"
    name = "General Assistant"
    version = PLATFORM_VERSION
    description = "Fallback when no registered capability matches."
    capabilities = [capability(GENERAL_CHAT, "General help and capability discovery", internal=True)]
    owner = "platform"

    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        available = request.input.get("available") or []
        listing = "\n".join(
            f"• {a['description'] or a['capability']}" + (f' — e.g. "{a["example"]}"' if a.get("example") else "")
            for a in available
        )
        if request.input.get("chart_without_data"):
            intro = "There's nothing to chart yet — ask for some data first."
        else:
            intro = "I couldn't match that request to a registered agent."
        text = f"{intro}\n\nHere's what I can help with right now:\n{listing}" if listing else (
            f"{intro} No business agents are registered for your tenant yet."
        )
        if self.platform is not None and not request.input.get("chart_without_data"):
            try:
                response = await self.platform.generate(
                    context,
                    request.input.get("message", ""),
                    system=GENERAL_PROMPT.render(capabilities=", ".join(a["capability"] for a in available)),
                    purpose="general",
                )
                if response.provider != "mock":
                    text = response.content.strip() or text
            except LLMError:
                pass
        return AgentResult.success({"available": available}, summary=text)


BUILTIN_AGENTS = (AggregateAgent, ChartAgent, DocumentAnswerAgent, GeneralChatAgent)
