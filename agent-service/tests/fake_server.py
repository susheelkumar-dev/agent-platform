"""Local end-to-end harness: the real service with the scripted test model instead of an LLM provider.

    python tests/fake_server.py 18100     (needs INTERNAL_API_KEY and, for data questions, GRIDTRADE_* settings)
"""

import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from agentsvc import llm_factory  # noqa: E402
from test_service import ScriptedModel  # noqa: E402

llm_factory.set_model_override(ScriptedModel())

if __name__ == "__main__":
    import main  # noqa: E402

    uvicorn.run(main.app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 18100)
