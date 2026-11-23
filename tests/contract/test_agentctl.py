"""agentctl: generated services must validate, pass their own tests and join a running platform."""

from __future__ import annotations

import importlib.util
import subprocess
import sys

import pytest

from agentctl.cli import main
from tests.conftest import running_stack

pytestmark = pytest.mark.anyio


def generate(tmp_path, *extra: str):
    main(["create", "weather", "--capability", "weather.forecast.read", "--keyword", "weather",
          "--keyword", "forecast", "--example", "What's the weather forecast?", "--permission", "weather.read",
          "--port", "8199", "--output", str(tmp_path), *extra])
    return tmp_path / "weather-agent"


def load_agent_class(root):
    spec = importlib.util.spec_from_file_location("generated_weather_agent", root / "agent.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.WeatherAgent


def test_create_generates_complete_service(tmp_path):
    root = generate(tmp_path)
    for name in ("agent.py", "main.py", "Dockerfile", "k8s.yaml", "requirements.txt", ".env.example",
                 "README.md", "tests/test_agent.py"):
        assert (root / name).exists(), name
    with pytest.raises(SystemExit) as exc:
        main(["validate", str(root / "agent.py")])
    assert exc.value.code == 0
    proc = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", str(root / "tests")],
                          cwd=root, capture_output=True, text=True, timeout=180)
    assert proc.returncode == 0, proc.stdout + proc.stderr


@pytest.mark.parametrize("template", ["llm", "rag"])
def test_llm_and_rag_templates_compile(tmp_path, template):
    root = generate(tmp_path, "--template", template, "--force")
    load_agent_class(root)


async def test_generated_agent_joins_platform_without_platform_changes(tmp_path):
    WeatherAgent = load_agent_class(generate(tmp_path))
    async with running_stack(agents={"weather.test": WeatherAgent()}) as s:
        denied = (await s.chat("What's the weather forecast for Mumbai?")).json()
        assert denied["status"] == "REJECTED" and "weather.read" in denied["response"]
        settings_tokens = s.container.settings.static_tokens
        settings_tokens["weather-user"] = {"user_id": "w", "tenant_id": "demo-tenant", "permissions": ["weather.read"]}
        body = (await s.chat("What's the weather forecast for Mumbai?", token="weather-user")).json()
        assert body["status"] == "COMPLETED", body
        assert body["capabilities"] == ["weather.forecast.read"]
        assert body["steps"]["s1"]["agent_id"] == "weather-agent"
