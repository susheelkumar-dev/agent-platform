"""Run: ``python main.py`` (dev) or ``uvicorn main:app --port 8102`` with AGENT_SERVICE_URL set."""

import os

from ai_agent_sdk import create_agent_app, run_agent

try:
    from .agent import ExposureAgent
except ImportError:  # executed as a script from this directory
    from agent import ExposureAgent

app = create_agent_app(ExposureAgent())

if __name__ == "__main__":
    run_agent(ExposureAgent(), port=int(os.getenv("PORT", "8102")))
