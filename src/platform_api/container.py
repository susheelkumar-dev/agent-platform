"""Composition root: builds every platform component from Settings.

No module-level singletons — each ``create_app()`` gets its own container, so
the platform can be embedded, run multiple times in tests, or mounted inside an
existing FastAPI application.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

import httpx

from ai_agents.base import BaseAgent
from ai_agents.health import HealthMonitor
from ai_agents.registry import AgentRegistry
from ai_core.config import Settings
from ai_core.events import InMemoryEventBus
from ai_core.models import AgentStatus, HealthStatus, RuntimeType
from ai_llm.gateway import LLMGateway
from ai_memory.conversation import ConversationService
from ai_observability.audit import AuditLogger
from ai_observability.metrics import PlatformMetrics
from ai_orchestration.builtin_agents import BUILTIN_AGENTS
from ai_orchestration.engine import ExecutionEngine, LangGraphExecutionEngine
from ai_orchestration.planner import LLMPlanner, RulePlanner
from ai_orchestration.resolver import CapabilityResolver
from ai_orchestration.response import ResponseBuilder
from ai_orchestration.validator import PlanValidator
from ai_rag.service import RAGService
from ai_runtime.runtime import (
    AgentRuntimeDispatcher,
    CircuitBreaker,
    LocalAgentRuntime,
    RemoteHttpAgentRuntime,
)
from ai_security.auth import AuthService
from ai_security.guardrails import GuardrailService, LengthGuardrail, PromptInjectionGuardrail
from ai_security.policy import PolicyEngine
from ai_security.ratelimit import InMemoryRateLimiter
from platform_api.services import ChatService, LocalPlatformServices

logger = logging.getLogger("platform_api.container")


class PlatformContainer:
    def __init__(
        self,
        settings: Settings,
        *,
        agent_transport: httpx.AsyncBaseTransport | None = None,
        llm_transport: httpx.AsyncBaseTransport | None = None,
        local_agents: Sequence[BaseAgent] = (),
        policy_engine: PolicyEngine | None = None,
    ) -> None:
        self.settings = settings
        self.metrics = PlatformMetrics()
        self.bus = InMemoryEventBus()
        self.db: Any = None
        self._build_storage()

        limits = httpx.Limits(max_connections=settings.agent_max_connections, max_keepalive_connections=50)
        self.agent_client = httpx.AsyncClient(
            transport=agent_transport, limits=limits, timeout=settings.agent_http_timeout_seconds
        )
        self.llm_client = httpx.AsyncClient(transport=llm_transport, timeout=settings.llm_timeout_seconds)

        self.registry = AgentRegistry(self.agent_repo, bus=self.bus)
        self.llm = LLMGateway(settings, self.llm_client, usage_store=self.usage_store, metrics=self.metrics)
        self.rag = RAGService(settings, self.document_store, self.vector_store, self.llm, bus=self.bus)
        self.conversations = ConversationService(self.conversation_store, context_messages=settings.context_messages)

        self.auth = AuthService.from_settings(settings)
        self.policy = policy_engine or PolicyEngine(settings)
        self.guardrails = GuardrailService(
            settings.guardrail_mode, [LengthGuardrail(settings.max_message_chars), PromptInjectionGuardrail()]
        )
        self.rate_limiter = InMemoryRateLimiter(settings.rate_limit_per_minute, settings.rate_limit_burst)

        self.platform_services = LocalPlatformServices(self)
        self.local_runtime = LocalAgentRuntime(self.platform_services)
        self.remote_runtime = RemoteHttpAgentRuntime(
            self.agent_client,
            service_token=settings.agent_service_token.get_secret_value(),
            signing_secret=settings.signing_secret.get_secret_value(),
            breaker=CircuitBreaker(settings.circuit_breaker_failures, settings.circuit_breaker_reset_seconds),
        )
        self.runtime = AgentRuntimeDispatcher(self.local_runtime, self.remote_runtime, metrics=self.metrics)

        engine_cls = LangGraphExecutionEngine if settings.engine == "langgraph" else ExecutionEngine
        self.engine = engine_cls(
            self.registry, self.runtime, self.executions, settings, bus=self.bus, metrics=self.metrics
        )
        self.resolver = CapabilityResolver(self.registry, self.llm, settings)
        rule_planner = RulePlanner(self.registry, settings)
        self.planner = LLMPlanner(self.registry, self.llm, rule_planner) if settings.planner_mode == "llm" \
            else rule_planner
        self.validator = PlanValidator(self.registry, self.policy, settings)
        self.response_builder = ResponseBuilder()
        self.audit = AuditLogger(self.audit_store)
        self.bus.add_listener(self.audit.on_event)
        self.chat = ChatService(self)
        self.health_monitor = HealthMonitor(
            self.registry,
            self.agent_client,
            interval_seconds=settings.health_check_interval_seconds,
            timeout_seconds=settings.health_check_timeout_seconds,
            unhealthy_after=settings.unhealthy_after_failures,
        )
        self._local_agents = [cls() for cls in BUILTIN_AGENTS] + list(local_agents)

    def _build_storage(self) -> None:
        s = self.settings
        if s.uses_memory_storage:
            from ai_storage import memory as m

            self.agent_repo = m.InMemoryAgentRepository()
            self.executions = m.InMemoryExecutionStore()
            self.conversation_store = m.InMemoryConversationStore()
            self.document_store = m.InMemoryDocumentStore()
            self.vector_store = m.InMemoryVectorStore()
            self.audit_store = m.InMemoryAuditStore()
            self.usage_store = m.InMemoryUsageStore()
            return
        from ai_storage import sql as q

        self.db = q.Database(s.database_url, pool_size=s.db_pool_size)
        self.agent_repo = q.SqlAgentRepository(self.db)
        self.executions = q.SqlExecutionStore(self.db)
        self.conversation_store = q.SqlConversationStore(self.db)
        self.document_store = q.SqlDocumentStore(self.db)
        self.vector_store = q.SqlVectorStore(self.db)
        self.audit_store = q.SqlAuditStore(self.db)
        self.usage_store = q.SqlUsageStore(self.db)

    # ---- lifecycle -----------------------------------------------------------------------
    async def startup(self) -> None:
        s = self.settings
        problems = s.production_problems()
        if problems:
            if s.is_production:
                raise RuntimeError("Refusing to start in production: " + "; ".join(problems))
            for p in problems:
                logger.warning("config (ok for %s, not for production): %s", s.environment, p)
        if self.db is not None and s.auto_create_schema:
            await self.db.create_schema()
        for agent in self._local_agents:
            await self.register_local_agent(agent)
        await self.local_runtime.startup()
        await self.recover_interrupted_executions()
        if s.enable_health_monitor:
            self.health_monitor.start()
        logger.info("platform started env=%s storage=%s engine=%s llm=%s", s.environment,
                    "memory" if self.db is None else self.db.url.split("://")[0], s.engine, s.llm_provider)

    async def recover_interrupted_executions(self) -> int:
        """Mark executions orphaned by a crash/restart as FAILED (they are not resumed).

        Only executions older than twice the workflow timeout are touched, so work
        still running on another replica is never affected.
        """
        from datetime import timedelta

        from ai_core.errors import ErrorCategory, ErrorInfo
        from ai_core.models import ExecutionStatus, StepStatus, utcnow

        cutoff = utcnow() - timedelta(seconds=self.settings.workflow_timeout_seconds * 2)
        stale = await self.executions.list_unfinished(cutoff)
        for record in stale:
            record.status = ExecutionStatus.FAILED
            record.error = ErrorInfo(code="INTERRUPTED", category=ErrorCategory.INFRASTRUCTURE,
                                     message="Execution was interrupted by a platform restart")
            record.completed_at = utcnow()
            for step in record.steps.values():
                if not step.status.terminal:
                    step.status = StepStatus.FAILED
                    step.skip_reason = "interrupted"
            await self.executions.save(record)
        if stale:
            logger.warning("marked %d interrupted execution(s) as FAILED", len(stale))
        return len(stale)

    async def register_local_agent(self, agent: BaseAgent) -> None:
        self.local_runtime.register(agent)
        await self.registry.register(agent.manifest(), runtime_type=RuntimeType.LOCAL)

    async def shutdown(self) -> None:
        await self.health_monitor.stop()
        await self.chat.shutdown()
        await self.local_runtime.shutdown()
        await self.agent_client.aclose()
        await self.llm_client.aclose()
        if self.db is not None:
            await self.db.dispose()

    async def refresh_gauges(self) -> None:
        counts: dict[tuple, float] = {}
        for record in await self.registry.list_agents():
            key = (("health", str(record.health)), ("status", str(record.status)))
            counts[key] = counts.get(key, 0) + 1
        for status in AgentStatus:
            for health in HealthStatus:
                counts.setdefault((("health", str(health)), ("status", str(status))), 0)
        self.metrics.registry_agents._values = counts
