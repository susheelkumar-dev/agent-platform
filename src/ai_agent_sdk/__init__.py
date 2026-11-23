"""AI Agent SDK — everything an agent team needs.

    from ai_agent_sdk import BaseAgent, AgentResult, Artifact, capability, run_agent

    class WeatherAgent(BaseAgent):
        agent_id = "weather-agent"
        name = "Weather Agent"
        version = "1.0.0"
        capabilities = [capability("weather.forecast.read", "Weather forecasts",
                                   keywords=["weather", "forecast", "temperature"])]
        permissions = ["weather.read"]

        async def execute(self, request, context):
            return AgentResult.success({"temp_c": 21}, summary="21°C and sunny")

    if __name__ == "__main__":
        run_agent(WeatherAgent(), port=8103)

Installing only the base package (``pip install ai-agent-platform``) is enough
for agent services; the heavy platform dependencies are optional extras.
"""

from ai_agent_sdk.service import create_agent_app, run_agent
from ai_agent_sdk.settings import AgentServiceSettings
from ai_agents.base import BaseAgent, PlatformServices, capability
from ai_core.errors import (
    AuthorizationError,
    PlatformError,
    RetryableAgentError,
    ValidationError,
)
from ai_core.models import (
    AgentContext,
    AgentManifest,
    AgentRequest,
    AgentResult,
    Artifact,
    CapabilitySpec,
    UserContext,
)
from ai_tools.base import BaseTool, ToolBox

__all__ = [
    "AgentContext",
    "AgentManifest",
    "AgentRequest",
    "AgentResult",
    "AgentServiceSettings",
    "Artifact",
    "AuthorizationError",
    "BaseAgent",
    "BaseTool",
    "CapabilitySpec",
    "PlatformError",
    "PlatformServices",
    "RetryableAgentError",
    "ToolBox",
    "UserContext",
    "ValidationError",
    "capability",
    "create_agent_app",
    "run_agent",
]
