"""Result Aggregator / Response Builder (LLD §3, Gap G19).

Turns an executed workflow into the user-facing answer: text, UI artifacts and
citations, plus the compact structured result remembered for follow-ups.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ai_core.models import ExecutionRecord, ExecutionStatus, StepStatus
from ai_orchestration.resolver import AGGREGATE, CHART, GENERAL_CHAT


@dataclass
class BuiltResponse:
    text: str
    ui: list[dict[str, Any]] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    last_result: dict[str, Any] | None = None
    results: dict[str, Any] = field(default_factory=dict)


class ResponseBuilder:
    def build(self, record: ExecutionRecord) -> BuiltResponse:
        plan = record.plan
        if plan is None:
            return BuiltResponse(text=record.error.message if record.error else "No plan was executed.")
        steps = [(s, record.steps.get(s.step_id)) for s in plan.steps]
        ok = {s.step_id: r for s, r in steps if r and r.status == StepStatus.SUCCEEDED and r.result}
        results = {sid: r.result for sid, r in ok.items()}

        agg = next((s for s, _ in steps if s.capability == AGGREGATE and s.step_id in ok), None)
        chart = next((s for s, _ in steps if s.capability == CHART and s.step_id in ok), None)
        data_steps = [s for s, _ in steps if s.capability not in (AGGREGATE, CHART)]

        texts: list[str] = []
        ui: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []

        if agg is not None:
            texts.append(self._summary(ok[agg.step_id].result))
            ui.extend(ok[agg.step_id].result.get("artifacts", []))
            for s in data_steps:
                if s.step_id in ok:
                    ui.extend(ok[s.step_id].result.get("artifacts", []))
        else:
            for s in data_steps:
                if s.step_id in ok:
                    summary = self._summary(ok[s.step_id].result)
                    if summary:
                        texts.append(summary)
                    ui.extend(ok[s.step_id].result.get("artifacts", []))
        if chart is not None:
            chart_result = ok[chart.step_id].result
            ui = [a for a in chart_result.get("artifacts", [])] + [a for a in ui if a.get("type") != "chart"]
            if not texts:
                texts.append(self._summary(chart_result))
        for r in ok.values():
            citations.extend((r.result or {}).get("citations", []))

        problems = []
        for s, r in steps:
            if r is None:
                continue
            if r.status == StepStatus.FAILED:
                msg = r.error.message if r.error else "failed"
                problems.append(f"⚠ {self._label(s.capability)} failed: {msg}")
            elif r.status == StepStatus.CANCELLED:
                problems.append(f"⚠ {self._label(s.capability)} was cancelled")
        if record.status == ExecutionStatus.CANCELLED and not problems:
            problems.append("⚠ The request was cancelled.")
        if record.error and record.error.code == "WORKFLOW_TIMEOUT":
            problems.append(f"⚠ {record.error.message}")

        text = "\n\n".join(t for t in texts if t)
        if problems:
            text = (text + "\n\n" if text else "") + "\n".join(problems)
        if not text:
            text = "The request was executed, but no agent returned a summary."

        last_result = None
        source = agg or next((s for s in reversed(data_steps) if s.step_id in ok and s.capability != GENERAL_CHAT), None)
        if source is not None:
            last_result = ok[source.step_id].result.get("output")
        elif chart is not None:
            last_result = (ok[chart.step_id].result.get("output") or {}).get("dataset")
        return BuiltResponse(text=text, ui=ui, citations=citations, last_result=last_result, results=results)

    @staticmethod
    def _summary(result: dict[str, Any] | None) -> str:
        if not result:
            return ""
        output = result.get("output") or {}
        return str(output.get("summary") or output.get("answer") or "")

    @staticmethod
    def _label(capability: str) -> str:
        return capability.replace("platform.", "").replace(".", " ")
