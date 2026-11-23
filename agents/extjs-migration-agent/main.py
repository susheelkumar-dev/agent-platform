"""Run: ``python main.py`` (dev) or ``uvicorn main:app --port 8120`` with AGENT_SERVICE_URL set."""

import os

from ai_agent_sdk import create_agent_app, run_agent

try:
    from .agent import ExtJsMigrationAgent
except ImportError:  # executed as a script from this directory
    from agent import ExtJsMigrationAgent

app = create_agent_app(ExtJsMigrationAgent())

if __name__ == "__main__":
    run_agent(ExtJsMigrationAgent(), port=int(os.getenv("PORT", "8120")))
