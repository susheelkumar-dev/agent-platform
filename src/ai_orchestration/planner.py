"""Planner: capabilities → structured, multi-step ExecutionPlan (LLD §9, Gap G07).

``RulePlanner`` is deterministic and covers the common shapes:

* one data capability                       → S1
* several data capabilities                 → S1 ∥ S2 ∥ … → aggregate (join, all_done)
* data + "chart"                            → S1 → chart
* "chart" alone as a follow-up              → chart($conversation.last_result)
* documents attached / document question    → document.answer
* nothing matched                           → general.chat (lists what the platform can do)

``LLMPlanner`` lets a model propose richer DAGs; its output is parsed into the
same contract and *always* goes through the PlanValidator. On any problem it
falls back to the rule planner.
"""

from __future__ import annotations

import logging
from typing import Any

from ai_agents.registry import AgentRegistry
from ai_core.config import Settings
from ai_core.errors import LLMError, RoutingError
from ai_core.models import (
    AgentRecord,
    CapabilityResolution,
    ChatRequest,
    ExecutionPlan,
    PlanStep,
    RetryPolicy,
    TriggerRule,
    UserContext,
)
from ai_llm.gateway import LLMGateway
from ai_llm.prompts import PLANNER
from ai_orchestration.resolver import AGGREGATE, CHART, DOCUMENT_ANSWER, GENERAL_CHAT

logger = logging.getLogger("ai_orchestration.planner")


class RulePlanner:
    name = "rule-v2"

    def __init__(self, registry: AgentRegistry, settings: Settings) -> None:
        self.registry = registry
        self.settings = settings

    async def _target(self, capability: str, tenant_id: str) -> AgentRecord | None:
        try:
            return await self.registry.select(capability, tenant_id=tenant_id)
        except RoutingError:
            return None  # the validator produces the authoritative rejection

    def _policies(self, record: AgentRecord | None) -> tuple[RetryPolicy, float]:
        s = self.settings
        timeout = min(record.manifest.timeout_seconds if record else s.default_step_timeout_seconds,
                      s.max_step_timeout_seconds)
        attempts = s.default_retry_attempts if (record is None or record.manifest.idempotent) else 1
        return RetryPolicy(max_attempts=attempts, backoff_seconds=s.retry_backoff_seconds), timeout

    async def _step(
        self, step_id: str, capability: str, user: UserContext, **kwargs: Any
    ) -> PlanStep:
        record = await self._target(capability, user.tenant_id)
        retry, timeout = self._policies(record)
        return PlanStep(
            step_id=step_id,
            capability=capability,
            agent_id=record.agent_id if record else None,
            agent_version=record.version if record else None,
            retry_policy=retry,
            timeout_seconds=timeout,
            **kwargs,
        )

    async def create_plan(
        self,
        request: ChatRequest,
        resolution: CapabilityResolution,
        user: UserContext,
        *,
        has_last_result: bool = False,
    ) -> ExecutionPlan:
        caps = resolution.capabilities
        wants_chart = CHART in caps
        data_caps = [c for c in caps if c not in (CHART, GENERAL_CHAT, AGGREGATE)]
        base_input = {"message": request.message, **request.variables}
        steps: list[PlanStep] = []

        for i, cap in enumerate(data_caps, start=1):
            static = dict(base_input)
            if cap == DOCUMENT_ANSWER:
                static["document_ids"] = request.attachments or None
            steps.append(await self._step(f"s{i}", cap, user, input=static, description=f"Run {cap}"))

        source_step: str | None = steps[-1].step_id if len(steps) == 1 else None
        if len(steps) >= 2:
            sources = [{"step_id": s.step_id, "capability": s.capability, "agent_id": s.agent_id} for s in steps]
            steps.append(
                await self._step(
                    "aggregate",
                    AGGREGATE,
                    user,
                    input={"message": request.message, "sources": sources},
                    input_mapping={s["step_id"]: f"$steps.{s['step_id']}.output" for s in sources},
                    depends_on=[s["step_id"] for s in sources],
                    trigger=TriggerRule.ALL_DONE,
                    description="Combine and compare results",
                )
            )
            source_step = "aggregate"

        if wants_chart:
            if source_step is not None:
                steps.append(
                    await self._step(
                        "chart",
                        CHART,
                        user,
                        input={"message": request.message},
                        input_mapping={"dataset": f"$steps.{source_step}.output"},
                        depends_on=[source_step],
                        description="Visualize the result",
                    )
                )
            elif has_last_result:
                steps.append(
                    await self._step(
                        "chart",
                        CHART,
                        user,
                        input={"message": request.message},
                        input_mapping={"dataset": "$conversation.last_result"},
                        description="Visualize the previous result",
                    )
                )

        if not steps:
            catalog = await self.registry.catalog(user.tenant_id, include_internal=False)
            offers = [
                {"capability": c.name, "description": c.description, "example": (c.examples or [""])[0]}
                for c in catalog
                if c.routable and not c.name.startswith("platform.")
            ]
            steps.append(
                await self._step(
                    "s1",
                    GENERAL_CHAT,
                    user,
                    input={"message": request.message, "available": offers,
                           "chart_without_data": wants_chart},
                    description="General assistance",
                )
            )

        return ExecutionPlan(
            request_id=request.request_id,
            steps=steps,
            variables=dict(request.variables),
            metadata={
                "planner": self.name,
                "resolution_method": resolution.method,
                "confidence": resolution.confidence,
            },
        )


class LLMPlanner:
    name = "llm-v2"

    def __init__(self, registry: AgentRegistry, llm: LLMGateway, fallback: RulePlanner) -> None:
        self.registry = registry
        self.llm = llm
        self.fallback = fallback

    async def create_plan(
        self,
        request: ChatRequest,
        resolution: CapabilityResolution,
        user: UserContext,
        *,
        has_last_result: bool = False,
    ) -> ExecutionPlan:
        try:
            catalog = await self.registry.catalog(user.tenant_id)
            text = "\n".join(f"- {c.name}: {c.description}" for c in catalog if c.routable)
            response = await self.llm.chat(
                PLANNER.render(catalog=text, message=request.message),
                purpose="planner",
                response_format="json",
                tenant_id=user.tenant_id,
                user_id=user.user_id,
                request_id=request.request_id,
            )
            raw_steps = (response.parsed or {}).get("steps") or []
            if not raw_steps:
                raise ValueError("empty plan")
            steps = []
            for raw in raw_steps:
                cap = raw["capability"]
                base = await self.fallback._step(
                    str(raw.get("step_id") or f"s{len(steps) + 1}"),
                    cap,
                    user,
                    input={"message": request.message, **request.variables, **(raw.get("input") or {})},
                    input_mapping=dict(raw.get("input_mapping") or {}),
                    depends_on=list(raw.get("depends_on") or []),
                    condition=raw.get("condition"),
                )
                steps.append(base)
            return ExecutionPlan(
                request_id=request.request_id,
                steps=steps,
                variables=dict(request.variables),
                metadata={"planner": self.name, "prompt": f"{PLANNER.name}@{PLANNER.version}"},
            )
        except (LLMError, KeyError, ValueError, TypeError) as exc:
            logger.warning("LLM planner failed (%s); using rule planner", exc)
            return await self.fallback.create_plan(request, resolution, user, has_last_result=has_last_result)
