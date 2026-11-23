"""Workflow execution engine (LLD §11-13, §30-31; Gaps G08-G11).

Executes a *validated* plan as a DAG:

* independent steps run concurrently (bounded by ``MAX_PARALLEL_STEPS``);
* dependents receive only explicitly mapped outputs (``input_mapping``);
* trigger rules (``all_success`` / ``all_done``) and safe conditions decide skips;
* per-step timeout, retry with exponential backoff on retryable categories,
  idempotency keys, and automatic failover to another healthy implementation of
  the same capability when an agent is unavailable;
* workflow-level timeout and cancellation;
* every state transition is persisted and published as an event.

Two schedulers share the same step executor: the native asyncio scheduler
(default) and a LangGraph scheduler (``ENGINE=langgraph``) that compiles the
validated plan into a StateGraph.
"""

from __future__ import annotations

import asyncio
import logging
import operator
import random
import time
from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict

from ai_agents.registry import AgentRegistry
from ai_core.config import Settings
from ai_core.errors import (
    ErrorCategory,
    ErrorInfo,
    PlatformError,
    StepTimeoutError,
    ValidationError,
)
from ai_core.events import EventBus, EventType, PlatformEvent
from ai_core.interfaces import AgentRuntime, ExecutionStore
from ai_core.models import (
    AgentContext,
    AgentRecord,
    AgentRequest,
    AgentResult,
    ExecutionRecord,
    ExecutionStatus,
    PlanStep,
    StepRecord,
    StepStatus,
    TriggerRule,
    ValidatedPlan,
    utcnow,
)
from ai_observability.tracing import span
from ai_orchestration.mapping import evaluate_condition, resolve_inputs

logger = logging.getLogger("ai_orchestration.engine")

try:  # optional input-schema validation
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None


@dataclass
class RunState:
    record: ExecutionRecord
    validated: ValidatedPlan
    context: AgentContext
    scope: dict[str, Any]
    context_token: str | None = None
    save_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class ExecutionEngine:
    def __init__(
        self,
        registry: AgentRegistry,
        runtime: AgentRuntime,
        store: ExecutionStore,
        settings: Settings,
        *,
        bus: EventBus | None = None,
        metrics: Any = None,
    ) -> None:
        self.registry = registry
        self.runtime = runtime
        self.store = store
        self.settings = settings
        self.bus = bus
        self.metrics = metrics
        self._semaphore = asyncio.Semaphore(settings.max_parallel_steps)
        self._running: dict[str, asyncio.Task] = {}

    # ---- public API ---------------------------------------------------------------------
    def is_running(self, execution_id: str) -> bool:
        return execution_id in self._running

    async def cancel(self, execution_id: str) -> bool:
        task = self._running.get(execution_id)
        if task is None or task.done():
            return False
        task.cancel()
        return True

    async def execute(
        self,
        record: ExecutionRecord,
        validated: ValidatedPlan,
        context: AgentContext,
        *,
        scope_extra: dict[str, Any] | None = None,
        context_token: str | None = None,
    ) -> ExecutionRecord:
        plan = validated.plan
        record.plan = plan
        record.policy_decisions = validated.policy_decisions
        record.steps = {
            s.step_id: StepRecord(
                step_id=s.step_id, capability=s.capability, agent_id=s.agent_id, agent_version=s.agent_version
            )
            for s in plan.steps
        }
        scope: dict[str, Any] = {
            "steps": {},
            "request": {"message": record.message, "attachments": context.knowledge_contexts},
            "variables": dict(plan.variables),
            "context": {
                "user_id": context.user.user_id,
                "tenant_id": context.user.tenant_id,
                "conversation_id": context.conversation_id,
                "request_id": context.request_id,
            },
            "conversation": {},
        }
        scope.update(scope_extra or {})
        state = RunState(record, validated, context, scope, context_token)
        record.status = ExecutionStatus.RUNNING
        record.started_at = utcnow()
        await self._save(state)
        await self._emit(state, EventType.EXECUTION_STARTED, levels=validated.execution_order)

        task = asyncio.create_task(self._run(state), name=f"execution-{record.execution_id}")
        self._running[record.execution_id] = task
        try:
            return await task
        finally:
            self._running.pop(record.execution_id, None)

    # ---- orchestration ----------------------------------------------------------------------
    async def _run(self, state: RunState) -> ExecutionRecord:
        record = state.record
        start = time.perf_counter()
        try:
            async with asyncio.timeout(self.settings.workflow_timeout_seconds):
                await self._schedule(state)
            record.status = self._final_status(state)
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None:
                current.uncancel()
            await self._mark_unfinished(state, StepStatus.CANCELLED, "execution cancelled")
            record.status = ExecutionStatus.CANCELLED
            record.error = ErrorInfo(code="CANCELLED", message="Execution was cancelled",
                                     category=ErrorCategory.CANCELLED)
        except TimeoutError:
            await self._mark_unfinished(state, StepStatus.FAILED, "workflow timeout")
            record.status = ExecutionStatus.FAILED
            record.error = ErrorInfo(
                code="WORKFLOW_TIMEOUT",
                message=f"Workflow exceeded {self.settings.workflow_timeout_seconds}s",
                category=ErrorCategory.TIMEOUT,
            )
        if record.status == ExecutionStatus.FAILED and record.error is None:
            failed = [s for s in record.steps.values() if s.status == StepStatus.FAILED]
            if failed:
                first = failed[0]
                record.error = ErrorInfo(
                    code="STEP_FAILED",
                    message=f"{len(failed)} step(s) failed; first: {first.step_id} ({first.capability}): "
                    f"{first.error.message if first.error else 'unknown error'}",
                    category=first.error.category if first.error else ErrorCategory.EXECUTION,
                )
        record.completed_at = utcnow()
        if self.metrics is not None:
            self.metrics.execution_latency.observe(time.perf_counter() - start)
        await self._save(state)
        return record

    def _final_status(self, state: RunState) -> ExecutionStatus:
        steps = {s.step_id: s for s in state.validated.plan.steps}
        for sid, rec in state.record.steps.items():
            if steps[sid].required and rec.status in (StepStatus.FAILED, StepStatus.CANCELLED):
                return ExecutionStatus.FAILED
        return ExecutionStatus.COMPLETED

    async def _schedule(self, state: RunState) -> None:
        plan = state.validated.plan
        records = state.record.steps
        pending = [s.step_id for s in plan.steps]
        running: dict[asyncio.Task, str] = {}
        try:
            while pending or running:
                progressed = True
                while progressed:
                    progressed = False
                    for sid in list(pending):
                        step = plan.step(sid)
                        if any(not records[d].status.terminal for d in step.depends_on):
                            continue
                        pending.remove(sid)
                        progressed = True
                        if await self._gate(state, step):
                            task = asyncio.create_task(self._run_step(state, step), name=f"step-{sid}")
                            running[task] = sid
                if not running:
                    if pending:  # unreachable for a validated DAG; guard against infinite loops
                        raise PlatformError(f"Unschedulable steps: {pending}", code="ENGINE_DEADLOCK")
                    break
                done, _ = await asyncio.wait(running, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    running.pop(task)
                    task.result()  # _run_step never raises except CancelledError
        finally:
            for task in running:
                task.cancel()
            if running:
                await asyncio.gather(*running, return_exceptions=True)

    async def _gate(self, state: RunState, step: PlanStep) -> bool:
        """Return True if the step should run; otherwise mark it SKIPPED/FAILED."""
        records = state.record.steps
        if step.trigger == TriggerRule.ALL_SUCCESS:
            bad = [d for d in step.depends_on if records[d].status != StepStatus.SUCCEEDED]
            if bad:
                await self._skip(state, step, f"dependency {', '.join(bad)} did not succeed")
                return False
        if step.condition:
            try:
                if not evaluate_condition(step.condition, state.scope):
                    await self._skip(state, step, f"condition is false: {step.condition}")
                    return False
            except PlatformError as exc:
                await self._fail(state, step, exc, attempts=0)
                return False
        return True

    # ---- step execution -----------------------------------------------------------------
    async def _run_step(self, state: RunState, step: PlanStep) -> None:
        rec = state.record.steps[step.step_id]
        try:
            async with self._semaphore:
                await self._run_step_inner(state, step, rec)
        except asyncio.CancelledError:
            if not rec.status.terminal:
                rec.status = StepStatus.CANCELLED
                rec.completed_at = utcnow()
            raise
        except Exception as exc:  # defensive: engine bugs must not kill the workflow silently
            logger.exception("unexpected engine error in step %s", step.step_id)
            await self._fail(state, step, PlatformError(str(exc), code="ENGINE_ERROR"), attempts=rec.attempts)

    async def _run_step_inner(self, state: RunState, step: PlanStep, rec: StepRecord) -> None:
        ctx = state.context
        try:
            target = await self.registry.get(step.agent_id, step.agent_version)  # type: ignore[arg-type]
            inputs = resolve_inputs(
                step.input, step.input_mapping, state.scope, strict=step.trigger == TriggerRule.ALL_SUCCESS
            )
            self._check_schema(target, step, inputs)
        except PlatformError as exc:
            await self._fail(state, step, exc, attempts=0)
            return

        rec.status = StepStatus.RUNNING
        rec.started_at = utcnow()
        policy = step.retry_policy
        timeout = step.timeout_seconds or target.manifest.timeout_seconds
        excluded: set[tuple[str, str]] = set()
        start = time.perf_counter()
        attempt = 0
        while True:
            attempt += 1
            rec.attempts = attempt
            rec.agent_id, rec.agent_version = target.agent_id, target.version
            await self._save(state)
            await self._emit(state, EventType.STEP_STARTED, step_id=step.step_id, capability=step.capability,
                             agent_id=target.agent_id, version=target.version, attempt=attempt)
            request = AgentRequest(
                request_id=ctx.request_id,
                agent_id=target.agent_id,
                agent_version=target.version,
                capability=step.capability,
                step_id=step.step_id,
                input=inputs,
                context=ctx,
                previous_results={d: state.scope["steps"].get(d, {}).get("output") for d in step.depends_on},
                idempotency_key=f"{state.record.execution_id}:{step.step_id}",
                attempt=attempt,
                deadline_seconds=timeout,
                context_token=state.context_token,
            )
            error: PlatformError | None = None
            try:
                with span("step.execute", step_id=step.step_id, capability=step.capability,
                          agent_id=target.agent_id, attempt=attempt):
                    async with asyncio.timeout(timeout):
                        result = await self.runtime.invoke(request, target)
                if result.status == "error":
                    error = PlatformError.from_info(
                        result.error or ErrorInfo(code="AGENT_ERROR", message="Agent reported an error")
                    )
                else:
                    await self._succeed(state, step, rec, result, start)
                    return
            except TimeoutError:
                error = StepTimeoutError(f"Step '{step.step_id}' exceeded {timeout}s")
            except PlatformError as exc:
                error = exc

            retry = error.retryable and error.category in policy.retry_on and attempt < policy.max_attempts
            if not retry:
                await self._fail(state, step, error, attempts=attempt, started=start)
                return
            if error.category == ErrorCategory.AGENT_UNAVAILABLE:
                excluded.add(target.key)
                target = await self._failover(step, target, excluded, ctx.user.tenant_id)
            delay = policy.delay_for(attempt) * (0.8 + 0.4 * random.random())
            if self.metrics is not None:
                self.metrics.step_retries.inc(capability=step.capability, category=str(error.category))
            await self._emit(state, EventType.STEP_RETRYING, step_id=step.step_id, attempt=attempt,
                             error=error.message, category=str(error.category), delay_seconds=round(delay, 2),
                             next_agent=f"{target.agent_id}@{target.version}")
            await asyncio.sleep(delay)

    async def _failover(
        self, step: PlanStep, current: AgentRecord, excluded: set[tuple[str, str]], tenant_id: str
    ) -> AgentRecord:
        self.registry.invalidate()
        for candidate in await self.registry.find_candidates(step.capability, tenant_id=tenant_id):
            if candidate.key not in excluded:
                logger.warning("failover step=%s from=%s@%s to=%s@%s", step.step_id, current.agent_id,
                               current.version, candidate.agent_id, candidate.version)
                return candidate
        return current

    def _check_schema(self, target: AgentRecord, step: PlanStep, inputs: dict[str, Any]) -> None:
        spec = target.manifest.capability(step.capability)
        if spec is None or not spec.input_schema or jsonschema is None:
            return
        try:
            jsonschema.validate(inputs, spec.input_schema)
        except jsonschema.ValidationError as exc:
            raise ValidationError(
                f"Input for '{step.capability}' violates the agent's schema: {exc.message}",
                code="INPUT_SCHEMA_VIOLATION",
            )

    # ---- state transitions -----------------------------------------------------------------
    async def _succeed(
        self, state: RunState, step: PlanStep, rec: StepRecord, result: AgentResult, started: float
    ) -> None:
        rec.status = StepStatus.SUCCEEDED
        rec.completed_at = utcnow()
        rec.duration_ms = round((time.perf_counter() - started) * 1000, 1)
        rec.result = result.model_dump(mode="json")
        rec.error = None
        state.scope["steps"][step.step_id] = {
            "status": rec.status.value,
            "output": result.output,
            "artifacts": result.artifacts,
            "citations": result.citations,
        }
        self._observe(step, rec)
        await self._save(state)
        await self._emit(
            state, EventType.STEP_COMPLETED, step_id=step.step_id, capability=step.capability,
            agent_id=rec.agent_id, duration_ms=rec.duration_ms, attempts=rec.attempts,
            summary=result.summary, artifacts=result.artifacts,
        )

    async def _fail(
        self, state: RunState, step: PlanStep, error: PlatformError, *, attempts: int, started: float | None = None
    ) -> None:
        rec = state.record.steps[step.step_id]
        rec.status = StepStatus.FAILED
        rec.attempts = attempts
        rec.completed_at = utcnow()
        if started is not None:
            rec.duration_ms = round((time.perf_counter() - started) * 1000, 1)
        rec.error = error.to_info(state.record.request_id)
        state.scope["steps"][step.step_id] = {"status": rec.status.value, "output": None,
                                               "error": rec.error.model_dump(mode="json")}
        self._observe(step, rec)
        logger.warning("step_failed step=%s capability=%s code=%s msg=%s", step.step_id, step.capability,
                       error.code, error.message)
        await self._save(state)
        await self._emit(state, EventType.STEP_FAILED, step_id=step.step_id, capability=step.capability,
                         agent_id=rec.agent_id, attempts=attempts, error=rec.error.model_dump(mode="json"))

    async def _skip(self, state: RunState, step: PlanStep, reason: str) -> None:
        rec = state.record.steps[step.step_id]
        rec.status = StepStatus.SKIPPED
        rec.skip_reason = reason
        rec.completed_at = utcnow()
        state.scope["steps"][step.step_id] = {"status": rec.status.value, "output": None}
        self._observe(step, rec)
        await self._save(state)
        await self._emit(state, EventType.STEP_SKIPPED, step_id=step.step_id, capability=step.capability,
                         reason=reason)

    async def _mark_unfinished(self, state: RunState, status: StepStatus, reason: str) -> None:
        for rec in state.record.steps.values():
            if not rec.status.terminal:
                rec.status = status
                rec.completed_at = utcnow()
                rec.skip_reason = reason
                if status == StepStatus.FAILED:
                    rec.error = ErrorInfo(code="WORKFLOW_TIMEOUT", message=reason, category=ErrorCategory.TIMEOUT)

    def _observe(self, step: PlanStep, rec: StepRecord) -> None:
        if self.metrics is None:
            return
        labels = {"capability": step.capability, "agent": rec.agent_id or "", "status": rec.status.value}
        self.metrics.steps.inc(**labels)
        if rec.duration_ms is not None:
            self.metrics.step_latency.observe(rec.duration_ms / 1000, capability=step.capability)

    async def _save(self, state: RunState) -> None:
        async with state.save_lock:
            try:
                await self.store.save(state.record)
            except Exception:
                logger.exception("failed to persist execution %s", state.record.execution_id)

    async def _emit(self, state: RunState, event_type: str, **payload: Any) -> None:
        if self.bus is None:
            return
        r = state.record
        await self.bus.publish(
            PlatformEvent(
                event_type=event_type,
                tenant_id=r.tenant_id,
                request_id=r.request_id,
                execution_id=r.execution_id,
                actor=r.user_id,
                payload=payload,
            )
        )


class GraphState(TypedDict):
    done: Annotated[list[str], operator.add]


class LangGraphExecutionEngine(ExecutionEngine):
    """Same semantics, scheduled by a LangGraph StateGraph compiled from the validated plan."""

    async def _schedule(self, state: RunState) -> None:
        from langgraph.graph import END, START, StateGraph

        plan = state.validated.plan
        graph = StateGraph(GraphState)
        children: dict[str, list[str]] = {s.step_id: [] for s in plan.steps}

        def make_node(step: PlanStep):
            async def node(_: GraphState) -> dict[str, list[str]]:
                if await self._gate(state, step):
                    await self._run_step(state, step)
                return {"done": [step.step_id]}

            return node

        for step in plan.steps:
            graph.add_node(step.step_id, make_node(step))
            for dep in step.depends_on:
                children[dep].append(step.step_id)
        for step in plan.steps:
            if not step.depends_on:
                graph.add_edge(START, step.step_id)
            elif len(step.depends_on) == 1:
                graph.add_edge(step.depends_on[0], step.step_id)
            else:
                graph.add_edge(list(step.depends_on), step.step_id)  # join: waits for all
            if not children[step.step_id]:
                graph.add_edge(step.step_id, END)
        compiled = graph.compile()
        await compiled.ainvoke({"done": []}, config={"recursion_limit": len(plan.steps) * 2 + 10})
