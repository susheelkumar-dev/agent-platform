"""Run: ``python main.py`` (dev) or ``uvicorn main:app --port 8101`` with AGENT_SERVICE_URL set."""

import os

from ai_agent_sdk import create_agent_app, run_agent

try:
    from .agent import InventoryAgent
except ImportError:  # executed as a script from this directory
    from agent import InventoryAgent

app = create_agent_app(InventoryAgent())

if __name__ == "__main__":
    run_agent(InventoryAgent(), port=int(os.getenv("PORT", "8101")))
