"""Unit tests: mapping, conditions, validator, resolver and the execution engine."""

from __future__ import annotations

import asyncio
import time

import pytest

from ai_agent_sdk.testing import make_context
from ai_agents.base import BaseAgent, capability
from ai_agents.registry import AgentRegistry
from ai_core.errors import AgentUnavailableError, AuthorizationError, PlatformError, ValidationError
from ai_core.events import InMemoryEventBus
from ai_core.models import (
    AgentResult,
    ChatRequest,
    ExecutionPlan,
    ExecutionRecord,
    ExecutionStatus,
    PlanStep,
    RetryPolicy,
    RuntimeType,
    StepStatus,
    TriggerRule,
    UserContext,
)
from ai_llm.gateway import LLMGateway
from ai_orchestration.engine import ExecutionEngine
from ai_orchestration.mapping import MappingError, evaluate_condition, resolve_ref
from ai_orchestration.resolver import CapabilityResolver
from ai_orchestration.validator import PlanValidator
from ai_runtime.runtime import LocalAgentRuntime
from ai_security.policy import PolicyEngine
from ai_storage.memory import InMemoryAgentRepository, InMemoryExecutionStore
from tests.conftest import make_settings

pytestmark = pytest.mark.anyio
USER = UserContext(user_id="u", tenant_id="t", permissions=["*"])


# ---------------------------------------------------------------- mapping / conditions
SCOPE = {
    "steps": {"s1": {"status": "SUCCEEDED", "output": {"total": 5, "rows": [{"v": 1}, {"v": 2}]}}},
    "request": {"message": "hi"},
    "variables": {"region": "EU"},
    "context": {"tenant_id": "t"},
    "conversation": {},
}


def test_resolve_refs():
    assert resolve_ref("$steps.s1.output.total", SCOPE) == 5
    assert resolve_ref("$steps.s1.output.rows.1.v", SCOPE) == 2
    assert resolve_ref("$variables.region", SCOPE) == "EU"
    assert resolve_ref("$steps.s1.output.missing", SCOPE, strict=False) is None
    with pytest.raises(MappingError):
        resolve_ref("$steps.s1.output.missing", SCOPE)
    with pytest.raises(MappingError):
        resolve_ref("steps.s1", SCOPE)


def test_conditions_are_safe():
    assert evaluate_condition("$steps.s1.output.total > 3 and $variables.region == 'EU'", SCOPE)
    assert not evaluate_condition("len($steps.s1.output.rows) > 5", SCOPE)
    assert evaluate_condition("$steps.s1.status in ['SUCCEEDED']", SCOPE)
    for evil in ("__import__('os').system('id')", "open('/etc/passwd')", "[x for x in ()]", "(1).__class__"):
        with pytest.raises(MappingError):
            evaluate_condition(evil, SCOPE)
    # references are dict-key walks, never attribute access: dunder names simply resolve to nothing
    assert evaluate_condition("$steps.s1.__class__ == None", SCOPE)


# ---------------------------------------------------------------- fixtures
class EchoAgent(BaseAgent):
    agent_id = "echo-agent"
    name = "Echo"
    version = "1.0.0"
    capabilities = [capability("test.echo.run", "echo", keywords=["echo"]),
                    capability("test.sum.run", "sum", keywords=["sum"])]

    def __init__(self, delay: float = 0.0):
        super().__init__()
        self.delay = delay
        self.calls: list[dict] = []

    async def execute(self, request, context):
        self.calls.append(request.input)
        await asyncio.sleep(self.delay)
        if request.capability == "test.sum.run":
            parts = [v for k, v in request.input.items() if k.startswith("in_") and v is not None]
            return AgentResult.success({"total": sum(p["value"] for p in parts)}, summary="summed")
        return AgentResult.success({"value": request.input.get("value", 1)}, summary="echo")


class FlakyAgent(BaseAgent):
    agent_id = "flaky-agent"
    name = "Flaky"
    version = "1.0.0"
    capabilities = [capability("test.flaky.run", "flaky", keywords=["flaky"])]

    def __init__(self, fail_times: int, retryable: bool = True):
        super().__init__()
        self.fail_times = fail_times
        self.retryable = retryable
        self.attempts = 0

    async def execute(self, request, context):
        self.attempts += 1
        if self.attempts <= self.fail_times:
            if self.retryable:
                raise AgentUnavailableError("temporarily down")
            return AgentResult.failure("bad input", code="BAD")
        return AgentResult.success({"ok": True}, summary="ok")


async def build(agents: list[BaseAgent], **settings_kw):
    settings = make_settings(**settings_kw)
    registry = AgentRegistry(InMemoryAgentRepository())
    runtime = LocalAgentRuntime()
    for a in agents:
        runtime.register(a)
        await registry.register(a.manifest(), runtime_type=RuntimeType.LOCAL)
    store = InMemoryExecutionStore()
    bus = InMemoryEventBus()
    engine = ExecutionEngine(registry, runtime, store, settings, bus=bus)
    validator = PlanValidator(registry, PolicyEngine(settings), settings)
    return engine, validator, registry, store


async def run(engine, validator, plan: ExecutionPlan, user: UserContext = USER) -> ExecutionRecord:
    validated = await validator.validate(plan, user)
    record = ExecutionRecord(request_id="r", tenant_id=user.tenant_id, user_id=user.user_id, conversation_id="c")
    return await engine.execute(record, validated, make_context(tenant_id=user.tenant_id))


# ---------------------------------------------------------------- validator
async def test_validator_rejects_cycles_unknown_deps_and_undeclared_data_flow():
    engine, validator, *_ = await build([EchoAgent()])
    cyclic = ExecutionPlan(steps=[
        PlanStep(step_id="a", capability="test.echo.run", depends_on=["b"]),
        PlanStep(step_id="b", capability="test.echo.run", depends_on=["a"]),
    ])
    with pytest.raises(ValidationError, match="cycle"):
        await validator.validate(cyclic, USER)
    unknown = ExecutionPlan(steps=[PlanStep(step_id="a", capability="test.echo.run", depends_on=["zzz"])])
    with pytest.raises(ValidationError, match="unknown step"):
        await validator.validate(unknown, USER)
    hidden = ExecutionPlan(steps=[
        PlanStep(step_id="a", capability="test.echo.run"),
        PlanStep(step_id="b", capability="test.echo.run", input_mapping={"x": "$steps.a.output"}),
    ])
    with pytest.raises(ValidationError, match="does not depend"):
        await validator.validate(hidden, USER)
    with pytest.raises(PlatformError, match="No registered agent"):
        await validator.validate(ExecutionPlan(steps=[PlanStep(step_id="a", capability="nope.cap.run")]), USER)


async def test_validator_enforces_permissions_and_tenants():
    class Secured(EchoAgent):
        agent_id = "secured"
        permissions = ["secret.read"]
        tenants = ["t"]

    engine, validator, *_ = await build([Secured()])
    plan = ExecutionPlan(steps=[PlanStep(step_id="a", capability="test.echo.run")])
    with pytest.raises(AuthorizationError, match="secret.read"):
        await validator.validate(plan, UserContext(user_id="x", tenant_id="t", permissions=["other"]))
    with pytest.raises(PlatformError):  # other tenant: agent not even a candidate
        await validator.validate(plan, UserContext(user_id="x", tenant_id="other", permissions=["*"]))
    validated = await validator.validate(plan, UserContext(user_id="x", tenant_id="t", permissions=["secret.*"]))
    assert validated.plan.steps[0].agent_id == "secured"


# ---------------------------------------------------------------- engine
async def test_parallel_steps_run_concurrently_and_pass_data():
    agent = EchoAgent(delay=0.3)
    engine, validator, *_ = await build([agent])
    plan = ExecutionPlan(steps=[
        PlanStep(step_id="a", capability="test.echo.run", input={"value": 2}),
        PlanStep(step_id="b", capability="test.echo.run", input={"value": 3}),
        PlanStep(step_id="c", capability="test.sum.run", depends_on=["a", "b"],
                 input_mapping={"in_a": "$steps.a.output", "in_b": "$steps.b.output"}),
    ])
    start = time.perf_counter()
    record = await run(engine, validator, plan)
    elapsed = time.perf_counter() - start
    assert record.status == ExecutionStatus.COMPLETED
    assert record.steps["c"].result["output"]["total"] == 5
    assert elapsed < 0.85, f"a and b should overlap (took {elapsed:.2f}s)"


async def test_retry_then_success_and_non_retryable_failure():
    flaky = FlakyAgent(fail_times=2)
    engine, validator, *_ = await build([flaky])
    plan = ExecutionPlan(steps=[PlanStep(step_id="a", capability="test.flaky.run",
                                         retry_policy=RetryPolicy(max_attempts=3, backoff_seconds=0.01))])
    record = await run(engine, validator, plan)
    assert record.status == ExecutionStatus.COMPLETED and record.steps["a"].attempts == 3

    bad = FlakyAgent(fail_times=5, retryable=False)
    engine, validator, *_ = await build([bad])
    record = await run(engine, validator, plan)
    assert record.status == ExecutionStatus.FAILED
    assert record.steps["a"].attempts == 1 and record.steps["a"].error.code == "BAD"


async def test_step_timeout_and_dependency_skip():
    engine, validator, *_ = await build([EchoAgent(delay=1.0)])
    plan = ExecutionPlan(steps=[
        PlanStep(step_id="a", capability="test.echo.run", timeout_seconds=0.1),
        PlanStep(step_id="b", capability="test.echo.run", depends_on=["a"]),
        PlanStep(step_id="c", capability="test.sum.run", depends_on=["a"], trigger=TriggerRule.ALL_DONE,
                 input_mapping={"in_a": "$steps.a.output"}, required=False),
    ])
    record = await run(engine, validator, plan)
    assert record.steps["a"].status == StepStatus.FAILED
    assert record.steps["a"].error.category == "TIMEOUT"
    assert record.steps["b"].status == StepStatus.SKIPPED
    assert record.steps["c"].status == StepStatus.FAILED or record.steps["c"].status == StepStatus.SUCCEEDED
    assert record.status == ExecutionStatus.FAILED


async def test_condition_skips_step():
    engine, validator, *_ = await build([EchoAgent()])
    plan = ExecutionPlan(steps=[
        PlanStep(step_id="a", capability="test.echo.run", input={"value": 1}),
        PlanStep(step_id="b", capability="test.echo.run", depends_on=["a"],
                 condition="$steps.a.output.value > 10"),
    ])
    record = await run(engine, validator, plan)
    assert record.status == ExecutionStatus.COMPLETED
    assert record.steps["b"].status == StepStatus.SKIPPED and "condition" in record.steps["b"].skip_reason


async def test_workflow_timeout():
    engine, validator, *_ = await build([EchoAgent(delay=2)], workflow_timeout_seconds=0.2)
    record = await run(engine, validator, ExecutionPlan(steps=[PlanStep(step_id="a", capability="test.echo.run")]))
    assert record.status == ExecutionStatus.FAILED and record.error.code == "WORKFLOW_TIMEOUT"


async def test_bounded_parallelism():
    agent = EchoAgent(delay=0.2)
    engine, validator, *_ = await build([agent], max_parallel_steps=1)
    plan = ExecutionPlan(steps=[PlanStep(step_id=f"s{i}", capability="test.echo.run") for i in range(3)])
    start = time.perf_counter()
    record = await run(engine, validator, plan)
    assert record.status == ExecutionStatus.COMPLETED
    assert time.perf_counter() - start >= 0.55


# ---------------------------------------------------------------- resolver
async def test_resolver_uses_manifest_hints_not_platform_code():
    class Weather(BaseAgent):
        agent_id = "weather-agent"
        name = "Weather"
        version = "1.0.0"
        capabilities = [capability("weather.forecast.read", "Forecasts", keywords=["weather", "forecast"],
                                   examples=["Will it rain in Pune tomorrow?"])]

        async def execute(self, request, context):
            return AgentResult.success()

    settings = make_settings()
    registry = AgentRegistry(InMemoryAgentRepository())
    await registry.register(Weather().manifest(), runtime_type=RuntimeType.LOCAL)
    import httpx

    resolver = CapabilityResolver(registry, LLMGateway(settings, httpx.AsyncClient()), settings)
    res = await resolver.resolve(ChatRequest(message="What's the weather forecast for Delhi?"), USER)
    assert res.capabilities == ["weather.forecast.read"]
    res = await resolver.resolve(ChatRequest(message="will it rain in Pune tomorrow"), USER)
    assert res.capabilities == ["weather.forecast.read"]  # matched via example similarity
    res = await resolver.resolve(ChatRequest(message="book a flight"), USER)
    assert res.capabilities == [] and res.method == "fallback"  # no general agent registered here
    with pytest.raises(PlatformError):
        await resolver.resolve(ChatRequest(message="x", capabilities=["unknown.cap.x"]), USER)
