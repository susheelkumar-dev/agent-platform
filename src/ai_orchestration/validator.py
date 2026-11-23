"""Plan Validator (LLD §10, Blueprint §11).

Every plan — rule-, LLM- or code-generated — passes through here before
execution. Rejections are explicit and carry the reason.
"""

from __future__ import annotations

from collections import deque

from ai_agents.registry import AgentRegistry
from ai_core.config import Settings
from ai_core.errors import AuthorizationError, PlatformError, RoutingError, ValidationError
from ai_core.models import ExecutionPlan, PolicyDecision, UserContext, ValidatedPlan
from ai_orchestration.mapping import parse_ref, referenced_step, refs_in, validate_condition
from ai_security.policy import PolicyEngine


def topological_levels(plan: ExecutionPlan) -> list[list[str]]:
    ids = [s.step_id for s in plan.steps]
    indegree = {sid: 0 for sid in ids}
    children: dict[str, list[str]] = {sid: [] for sid in ids}
    for step in plan.steps:
        for dep in step.depends_on:
            indegree[step.step_id] += 1
            children[dep].append(step.step_id)
    queue = deque(sid for sid in ids if indegree[sid] == 0)
    levels: list[list[str]] = []
    seen = 0
    while queue:
        level = list(queue)
        queue.clear()
        levels.append(level)
        for sid in level:
            seen += 1
            for child in children[sid]:
                indegree[child] -= 1
                if indegree[child] == 0:
                    queue.append(child)
    if seen != len(ids):
        cyclic = sorted(sid for sid, d in indegree.items() if d > 0)
        raise ValidationError(f"Plan has a dependency cycle involving: {', '.join(cyclic)}", code="PLAN_CYCLE")
    return levels


def ancestors(plan: ExecutionPlan, step_id: str) -> set[str]:
    by_id = {s.step_id: s for s in plan.steps}
    out: set[str] = set()
    stack = list(by_id[step_id].depends_on)
    while stack:
        sid = stack.pop()
        if sid not in out:
            out.add(sid)
            stack.extend(by_id[sid].depends_on)
    return out


class PlanValidator:
    version = "2"

    def __init__(self, registry: AgentRegistry, policy: PolicyEngine, settings: Settings) -> None:
        self.registry = registry
        self.policy = policy
        self.settings = settings

    async def validate(self, plan: ExecutionPlan, user: UserContext) -> ValidatedPlan:
        if not plan.steps:
            raise ValidationError("Plan has no steps", code="EMPTY_PLAN")

        decisions: list[PolicyDecision] = []
        limits = self.policy.evaluate_plan_limits(user, plan)
        decisions.append(limits)
        if not limits.allowed:
            raise ValidationError(f"Plan exceeds execution limits: {limits.reason}", code="PLAN_TOO_LARGE")

        ids = [s.step_id for s in plan.steps]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValidationError(f"Duplicate step IDs: {', '.join(duplicates)}", code="DUPLICATE_STEP")
        known = set(ids)
        for step in plan.steps:
            for dep in step.depends_on:
                if dep == step.step_id:
                    raise ValidationError(f"Step '{step.step_id}' depends on itself", code="PLAN_CYCLE")
                if dep not in known:
                    raise ValidationError(
                        f"Step '{step.step_id}' depends on unknown step '{dep}'", code="UNKNOWN_DEPENDENCY"
                    )
        levels = topological_levels(plan)

        for step in plan.steps:
            upstream = ancestors(plan, step.step_id)
            refs = list(step.input_mapping.values())
            if step.condition:
                refs += validate_condition(step.condition) or refs_in(step.condition)
            for ref in refs:
                parse_ref(ref)
                target = referenced_step(ref)
                if target is not None and target not in upstream:
                    raise ValidationError(
                        f"Step '{step.step_id}' references '{ref}' but does not depend on '{target}'",
                        code="UNDECLARED_DATA_DEPENDENCY",
                    )
            if step.timeout_seconds and step.timeout_seconds > self.settings.max_step_timeout_seconds:
                raise ValidationError(
                    f"Step '{step.step_id}' timeout {step.timeout_seconds}s exceeds the maximum "
                    f"{self.settings.max_step_timeout_seconds}s",
                    code="TIMEOUT_TOO_LARGE",
                )

            try:
                record = await self.registry.select(
                    step.capability, tenant_id=user.tenant_id, agent_id=step.agent_id, version=step.agent_version
                )
            except RoutingError as exc:
                raise RoutingError(f"Step '{step.step_id}': {exc.message}", code=exc.code, details=exc.details)
            step.agent_id = record.agent_id
            step.agent_version = record.version
            if record.manifest.capability(step.capability) is None:  # defensive; select() guarantees this
                raise ValidationError(f"Agent '{record.agent_id}' does not implement '{step.capability}'")

            step_decisions = self.policy.evaluate_step(user, record, step)
            decisions.extend(step_decisions)
            denied = [d for d in step_decisions if not d.allowed]
            if denied:
                raise AuthorizationError(
                    f"Step '{step.step_id}' ({step.capability}) denied: " + "; ".join(d.reason for d in denied),
                    code="POLICY_DENIED",
                    details={"decisions": [d.model_dump(mode="json") for d in denied]},
                )

        return ValidatedPlan(plan=plan, policy_decisions=decisions, execution_order=levels,
                             validator_version=self.version)


__all__ = ["PlanValidator", "PlatformError", "ancestors", "topological_levels"]
