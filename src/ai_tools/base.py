"""Tool framework (Arch §15, LLD §15).

Tools are controlled, permissioned, observable execution units. Agents call
them through a ``ToolBox`` which enforces the caller's permissions and records
timing, so sensitive systems are exposed as *semantic operations* (e.g.
``get_inventory_summary``) rather than raw database or network access.
"""

from __future__ import annotations

import inspect
import logging
import time
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

from ai_core.errors import AuthorizationError, NotFoundError
from ai_core.models.common import missing_permissions

if TYPE_CHECKING:
    from ai_core.models import AgentContext

logger = logging.getLogger("ai_tools")


class BaseTool(ABC):
    name: str
    description: str = ""
    version: str = "1.0.0"
    permissions: list[str] = []  # permissions the *calling user* must hold
    input_schema: dict[str, Any] | None = None

    @abstractmethod
    async def execute(self, input: dict[str, Any], context: AgentContext | None = None) -> dict[str, Any]:
        raise NotImplementedError

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "permissions": list(self.permissions),
            "input_schema": self.input_schema,
        }


class ToolBox:
    """Permission-checked, timed access to an agent's tools."""

    def __init__(self, tools: list[BaseTool] | None = None, *, metrics: Any = None) -> None:
        self._tools: dict[str, BaseTool] = {}
        self._metrics = metrics
        for tool in tools or []:
            self.register(tool)

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool:
        try:
            return self._tools[name]
        except KeyError:
            raise NotFoundError(f"Tool '{name}' is not available to this agent", code="TOOL_NOT_FOUND")

    @property
    def names(self) -> list[str]:
        return sorted(self._tools)

    def __getattr__(self, item: str) -> BaseTool:
        # allows ``self.tools.inventory_api`` style access (hyphens -> underscores)
        tools = self.__dict__.get("_tools", {})
        for name, tool in tools.items():
            if name.replace("-", "_") == item:
                return tool
        raise AttributeError(item)

    async def call(
        self, name: str, input: dict[str, Any] | None = None, context: AgentContext | None = None
    ) -> dict[str, Any]:
        tool = self.get(name)
        if context is not None and tool.permissions:
            missing = missing_permissions(context.user.permissions, tool.permissions)
            if missing:
                raise AuthorizationError(
                    f"User lacks permissions {missing} required by tool '{name}'",
                    code="TOOL_FORBIDDEN",
                    details={"tool": name, "missing": missing},
                )
        start = time.perf_counter()
        ok = False
        try:
            params = inspect.signature(tool.execute).parameters
            if len(params) >= 2:
                result = await tool.execute(input or {}, context)
            else:  # v1 tools: execute(self, input)
                result = await tool.execute(input or {})  # type: ignore[call-arg]
            ok = True
            return result
        finally:
            elapsed = (time.perf_counter() - start) * 1000
            logger.debug("tool_call tool=%s ok=%s duration_ms=%.1f", name, ok, elapsed)
            if self._metrics is not None:
                self._metrics.tool_calls.inc(tool=name, status="ok" if ok else "error")
