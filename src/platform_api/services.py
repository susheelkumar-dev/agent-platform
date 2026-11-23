"""Application services: platform services for in-process agents, and the chat lifecycle."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from ai_core.errors import ErrorInfo, PlatformError
from ai_core.events import EventType, PlatformEvent
from ai_core.models import (
    AgentContext,
    ChatRequest,
    ChatResponse,
    ExecutionRecord,
    ExecutionStatus,
    LLMMessage,
    LLMRequest,
    LLMResponse,
    RetrievalQuery,
    RetrievedChunk,
    UserContext,
    utcnow,
)
from ai_llm.prompts import COMPOSE
from ai_memory.conversation import compact_result
from ai_observability.logging import bind, unbind
from ai_security.signing import issue_context_token

if TYPE_CHECKING:
    from platform_api.container import PlatformContainer

logger = logging.getLogger("platform_api.chat")


class LocalPlatformServices:
    """PlatformServices for in-process agents (direct calls, same accounting as remote)."""

    def __init__(self, container: PlatformContainer) -> None:
        self.c = container

    async def generate(
        self,
        context: AgentContext,
        prompt: str | None = None,
        *,
        messages: list[dict[str, str]] | None = None,
        system: str | None = None,
        response_format: str = "text",
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 1024,
        purpose: str = "agent",
        metadata: dict[str, Any] | None = None,
    ) -> LLMResponse:
        msgs = [LLMMessage(**m) for m in (messages or [])]
        if prompt:
            msgs.append(LLMMessage(role="user", content=prompt))
        return await self.c.llm.generate(
            LLMRequest(
                messages=msgs,
                system=system,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,  # type: ignore[arg-type]
                purpose=purpose,
                metadata=metadata or {},
            ),
            tenant_id=context.user.tenant_id,
            user_id=context.user.user_id,
            request_id=context.request_id,
            execution_id=context.execution_id,
        )

    async def search(
        self,
        context: AgentContext,
        query: str,
        *,
        top_k: int = 5,
        document_ids: list[str] | None = None,
        knowledge_base: str | None = None,
    ) -> list[RetrievedChunk]:
        return await self.c.rag.search(
            context.user.tenant_id,
            RetrievalQuery(query=query, top_k=top_k, document_ids=document_ids, knowledge_base=knowledge_base),
        )


class ChatService:
    """Owns the request lifecycle (Arch §6):

    guardrails → conversation context → capability resolution → planning →
    validation/policy → orchestration → response building → memory → events.
    """

    def __init__(self, container: PlatformContainer) -> None:
        self.c = container
        self._background: set[asyncio.Task] = set()

    # ---- entry points ------------------------------------------------------------------------
    async def handle(self, request: ChatRequest, user: UserContext) -> ChatResponse:
        record, context, history = await self._prepare(request, user)
        return await self._process(request, user, record, context, history)

    async def submit(self, request: ChatRequest, user: UserContext) -> ExecutionRecord:
        record, context, history = await self._prepare(request, user)
        task = asyncio.create_task(self._process(request, user, record, context, history))
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return record

    async def shutdown(self) -> None:
        for task in list(self._background):
            task.cancel()
        if self._background:
            await asyncio.gather(*self._background, return_exceptions=True)

    # ---- lifecycle ------------------------------------------------------------------------------
    async def _prepare(
        self, request: ChatRequest, user: UserContext
    ) -> tuple[ExecutionRecord, AgentContext, list[dict]]:
        c = self.c
        await c.rate_limiter.hit(f"user:{user.tenant_id}:{user.user_id}")
        findings = c.guardrails.inspect(request.message)
        await c.conversations.open(user, request.conversation_id, request.message)
        for doc_id in request.attachments:  # tenant check on attachments
            await c.rag.get_document(user, doc_id)
        history = await c.conversations.history(request.conversation_id)
        await c.conversations.add_user(
            request.conversation_id, request.message, request_id=request.request_id, attachments=request.attachments
        )
        record = ExecutionRecord(
            request_id=request.request_id,
            tenant_id=user.tenant_id,
            user_id=user.user_id,
            conversation_id=request.conversation_id,
            message=request.message,
            status=ExecutionStatus.PLANNING,
            metadata={"mode": request.mode, **({"guardrail_findings": [f.model_dump() for f in findings]}
                                               if findings else {})},
        )
        context = AgentContext(
            request_id=request.request_id,
            execution_id=record.execution_id,
            conversation_id=request.conversation_id,
            user=user,
            messages=history + [{"role": "user", "content": request.message}],
            variables=dict(request.variables),
            knowledge_contexts=list(request.attachments),
            metadata={**request.metadata, **({"guardrail_flags": [f.guardrail for f in findings]} if findings else {})},
        )
        await c.executions.save(record)
        await self._emit(record, EventType.EXECUTION_CREATED, message=request.message[:500], mode=request.mode)
        if findings:
            if c.metrics:
                for f in findings:
                    c.metrics.guardrail_findings.inc(guardrail=f.guardrail)
            await self._emit(record, EventType.GUARDRAIL_TRIGGERED, findings=[f.model_dump() for f in findings])
        return record, context, history

    async def _process(
        self,
        request: ChatRequest,
        user: UserContext,
        record: ExecutionRecord,
        context: AgentContext,
        history: list[dict],
    ) -> ChatResponse:
        c = self.c
        tokens = bind(request_id=request.request_id, execution_id=record.execution_id,
                      tenant_id=user.tenant_id, user_id=user.user_id)
        started = time.perf_counter()
        try:
            last_result = await c.conversations.last_result(request.conversation_id)
            try:
                resolution = await c.resolver.resolve(request, user, history)
                plan = await c.planner.create_plan(request, resolution, user, has_last_result=last_result is not None)
                record.plan = plan
                record.status = ExecutionStatus.VALIDATING
                record.metadata["resolution"] = resolution.model_dump(mode="json")
                await c.executions.save(record)
                await self._emit(record, EventType.PLAN_CREATED, plan=plan.model_dump(mode="json"),
                                 capabilities=resolution.capabilities, method=resolution.method)
                validated = await c.validator.validate(plan, user)
            except PlatformError as exc:
                return await self._reject(request, record, exc)

            record.status = ExecutionStatus.READY
            await self._emit(record, EventType.PLAN_VALIDATED, plan=validated.plan.model_dump(mode="json"),
                             levels=validated.execution_order)
            token = issue_context_token(
                c.settings.signing_secret.get_secret_value(),
                {
                    "tenant_id": user.tenant_id,
                    "user_id": user.user_id,
                    "execution_id": record.execution_id,
                    "request_id": request.request_id,
                    "conversation_id": request.conversation_id,
                    "permissions": user.permissions,
                },
                ttl_seconds=c.settings.context_token_ttl_seconds,
            )
            record = await c.engine.execute(
                record,
                validated,
                context,
                scope_extra={"conversation": {"last_result": last_result}},
                context_token=token,
            )
            return await self._finalize(request, record, resolution.capabilities)
        except asyncio.CancelledError:
            record.status = ExecutionStatus.CANCELLED
            await c.executions.save(record)
            raise
        except Exception as exc:  # unexpected failure: persist and surface a clean error
            logger.exception("execution crashed")
            record.status = ExecutionStatus.FAILED
            record.error = (exc.to_info(request.request_id) if isinstance(exc, PlatformError)
                            else ErrorInfo(code="INTERNAL_ERROR", message="Internal error while executing request"))
            return await self._finalize(request, record, [])
        finally:
            if c.metrics:
                c.metrics.executions.inc(status=str(record.status))
            logger.info("execution_finished status=%s duration_ms=%.0f", record.status,
                        (time.perf_counter() - started) * 1000)
            unbind(tokens)

    async def _reject(self, request: ChatRequest, record: ExecutionRecord, exc: PlatformError) -> ChatResponse:
        c = self.c
        record.status = ExecutionStatus.REJECTED
        record.error = exc.to_info(request.request_id)
        if exc.code == "NO_HEALTHY_AGENT":
            capability = exc.details.get("capability", "requested")
            record.response = (f"The service for '{capability}' is temporarily unavailable. "
                               "Please try again shortly.")
        else:
            record.response = f"I can't run that request: {exc.message}"
        record.completed_at = utcnow()
        await c.executions.save(record)
        await c.conversations.add_assistant(
            request.conversation_id, record.response, execution_id=record.execution_id, status=record.status
        )
        if exc.code == "POLICY_DENIED":
            if c.metrics:
                c.metrics.policy_denials.inc(policy="plan")
            await self._emit(record, EventType.POLICY_VIOLATION, error=record.error.model_dump(mode="json"))
        response = self._to_response(record, [])
        await self._emit(record, EventType.PLAN_REJECTED, error=record.error.model_dump(mode="json"),
                         response=response.model_dump(mode="json"))
        return response

    async def _finalize(self, request: ChatRequest, record: ExecutionRecord, capabilities: list[str]) -> ChatResponse:
        c = self.c
        built = c.response_builder.build(record)
        text = built.text
        if c.settings.compose_with_llm and not c.llm.is_mock and built.results and \
                record.status == ExecutionStatus.COMPLETED:
            try:
                summaries = "\n".join(
                    f"- {sid}: {(r.get('output') or {}).get('summary', '')}" for sid, r in built.results.items()
                )
                composed = await c.llm.chat(
                    COMPOSE.render(message=request.message, results=summaries),
                    purpose="compose",
                    tenant_id=record.tenant_id,
                    user_id=record.user_id,
                    request_id=record.request_id,
                    execution_id=record.execution_id,
                    metadata={"fallback": text},
                )
                text = composed.content.strip() or text
            except PlatformError:
                logger.warning("LLM composition failed; using deterministic response")
        record.response = text
        record.ui = built.ui
        record.usage = self._usage(record)
        await c.executions.save(record)
        await c.conversations.add_assistant(
            request.conversation_id,
            text,
            execution_id=record.execution_id,
            status=str(record.status),
            capabilities=capabilities,
            result=compact_result(built.last_result),
            ui=built.ui[:20],
        )
        response = self._to_response(record, capabilities, built.citations, built.results)
        event = {
            ExecutionStatus.COMPLETED: EventType.EXECUTION_COMPLETED,
            ExecutionStatus.CANCELLED: EventType.EXECUTION_CANCELLED,
        }.get(record.status, EventType.EXECUTION_FAILED)
        await self._emit(record, event, status=str(record.status), response=response.model_dump(mode="json"))
        return response

    @staticmethod
    def _usage(record: ExecutionRecord) -> dict[str, Any]:
        tokens = 0
        for step in record.steps.values():
            usage = (step.result or {}).get("usage") or {}
            tokens += int(usage.get("total_tokens", 0) or 0)
        durations = [s.duration_ms for s in record.steps.values() if s.duration_ms]
        return {
            "steps": len(record.steps),
            "agent_reported_tokens": tokens,
            "total_step_ms": round(sum(durations), 1),
        }

    @staticmethod
    def _to_response(
        record: ExecutionRecord,
        capabilities: list[str],
        citations: list[dict] | None = None,
        results: dict[str, Any] | None = None,
    ) -> ChatResponse:
        caps = capabilities or ([s.capability for s in record.plan.steps] if record.plan else [])
        return ChatResponse(
            request_id=record.request_id,
            execution_id=record.execution_id,
            conversation_id=record.conversation_id,
            status=record.status,
            capability=caps[0] if caps else None,
            capabilities=caps,
            response=record.response or "",
            plan=record.plan,
            steps=record.steps,
            results=results or {},
            ui=record.ui,
            citations=citations or [],
            usage=record.usage,
            error=record.error,
        )

    async def _emit(self, record: ExecutionRecord, event_type: str, **payload: Any) -> None:
        await self.c.bus.publish(
            PlatformEvent(
                event_type=event_type,
                tenant_id=record.tenant_id,
                request_id=record.request_id,
                execution_id=record.execution_id,
                actor=record.user_id,
                payload=payload,
            )
        )
