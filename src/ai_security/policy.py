"""Central Policy Engine (Arch §18, LLD §20, Gap G15).

Every executable step gets an explicit, recorded ``PolicyDecision``. Rules are
small classes; organizations add their own (e.g. an OPA/Cedar adapter, data
residency, business-hours restrictions) by appending to ``PolicyEngine.rules``.
"""

from __future__ import annotations

import fnmatch
from typing import Any, Protocol

from ai_core.config import Settings
from ai_core.errors import AuthorizationError
from ai_core.models import AgentRecord, ExecutionPlan, PlanStep, PolicyDecision, UserContext
from ai_core.models.common import has_permissions, missing_permissions


class PolicyRule(Protocol):
    name: str

    def evaluate(self, user: UserContext, record: AgentRecord, step: PlanStep) -> PolicyDecision | None:
        """Return a decision, or None if the rule does not apply."""


class TenantScopeRule:
    name = "tenant-scope"

    def evaluate(self, user: UserContext, record: AgentRecord, step: PlanStep) -> PolicyDecision:
        allowed = record.manifest.allows_tenant(user.tenant_id)
        return PolicyDecision(
            step_id=step.step_id,
            policy=self.name,
            allowed=allowed,
            reason="agent serves tenant" if allowed else f"agent does not serve tenant '{user.tenant_id}'",
        )


class PermissionRule:
    name = "rbac-permissions"

    def evaluate(self, user: UserContext, record: AgentRecord, step: PlanStep) -> PolicyDecision:
        spec = record.manifest.capability(step.capability)
        required = sorted(set(record.manifest.permissions) | set(spec.permissions if spec else []))
        missing = missing_permissions(user.permissions, required)
        return PolicyDecision(
            step_id=step.step_id,
            policy=self.name,
            allowed=not missing,
            reason="permissions satisfied" if not missing else f"missing permissions: {', '.join(missing)}",
            details={"required": required, "missing": missing},
        )


class TenantCapabilityRule:
    """Per-tenant allow/deny lists: ``TENANT_POLICIES={"acme": {"deny_capabilities": ["trading.*"]}}``."""

    name = "tenant-capabilities"

    def __init__(self, tenant_policies: dict[str, dict[str, Any]]) -> None:
        self.tenant_policies = tenant_policies

    def evaluate(self, user: UserContext, record: AgentRecord, step: PlanStep) -> PolicyDecision | None:
        policy = self.tenant_policies.get(user.tenant_id) or self.tenant_policies.get("*")
        if not policy:
            return None
        cap = step.capability
        deny = policy.get("deny_capabilities", [])
        allow = policy.get("allow_capabilities")
        if any(fnmatch.fnmatch(cap, p) for p in deny):
            return PolicyDecision(step_id=step.step_id, policy=self.name, allowed=False,
                                  reason=f"capability '{cap}' denied for tenant")
        if allow is not None and not cap.startswith("platform.") and not any(
            fnmatch.fnmatch(cap, p) for p in allow
        ):
            return PolicyDecision(step_id=step.step_id, policy=self.name, allowed=False,
                                  reason=f"capability '{cap}' not in tenant allow-list")
        return PolicyDecision(step_id=step.step_id, policy=self.name, allowed=True, reason="tenant policy ok")


class PolicyEngine:
    def __init__(self, settings: Settings, rules: list[PolicyRule] | None = None) -> None:
        self.settings = settings
        self.rules: list[PolicyRule] = rules or [
            TenantScopeRule(),
            PermissionRule(),
            TenantCapabilityRule(settings.tenant_policies),
        ]

    def max_steps_for(self, tenant_id: str) -> int:
        policy = self.settings.tenant_policies.get(tenant_id, {})
        return int(policy.get("max_steps", self.settings.max_plan_steps))

    def evaluate_step(self, user: UserContext, record: AgentRecord, step: PlanStep) -> list[PolicyDecision]:
        decisions = []
        for rule in self.rules:
            decision = rule.evaluate(user, record, step)
            if decision is not None:
                decisions.append(decision)
        return decisions

    def evaluate_plan_limits(self, user: UserContext, plan: ExecutionPlan) -> PolicyDecision:
        limit = self.max_steps_for(user.tenant_id)
        ok = len(plan.steps) <= limit
        return PolicyDecision(
            policy="execution-limits",
            allowed=ok,
            reason=f"{len(plan.steps)} steps (limit {limit})",
        )


def require_permission(user: UserContext, *permissions: str) -> None:
    if not has_permissions(user.permissions, list(permissions)):
        raise AuthorizationError(
            f"Missing permission(s): {', '.join(missing_permissions(user.permissions, list(permissions)))}",
            code="FORBIDDEN",
        )
