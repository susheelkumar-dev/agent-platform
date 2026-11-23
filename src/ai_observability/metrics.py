"""Dependency-free Prometheus metrics (text exposition format 0.0.4).

Exposed at ``GET /metrics``. Scrape with Prometheus / Grafana Agent / Datadog
OpenMetrics integration.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable

DEFAULT_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120)


def _labels(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    inner = ",".join(f'{k}="{str(v).replace(chr(92), "/").replace(chr(34), chr(39))}"' for k, v in sorted(labels.items()))
    return "{" + inner + "}"


class _Metric:
    kind = "untyped"

    def __init__(self, name: str, help_text: str) -> None:
        self.name = name
        self.help = help_text
        self._lock = threading.Lock()

    def header(self) -> list[str]:
        return [f"# HELP {self.name} {self.help}", f"# TYPE {self.name} {self.kind}"]


class Counter(_Metric):
    kind = "counter"

    def __init__(self, name: str, help_text: str) -> None:
        super().__init__(name, help_text)
        self._values: dict[tuple, float] = {}

    def inc(self, amount: float = 1.0, **labels: str) -> None:
        key = tuple(sorted(labels.items()))
        with self._lock:
            self._values[key] = self._values.get(key, 0.0) + amount

    def value(self, **labels: str) -> float:
        return self._values.get(tuple(sorted(labels.items())), 0.0)

    def render(self) -> Iterable[str]:
        yield from self.header()
        for key, value in self._values.items():
            yield f"{self.name}{_labels(dict(key))} {value}"


class Gauge(_Metric):
    kind = "gauge"

    def __init__(self, name: str, help_text: str, collector: Callable[[], dict[tuple, float]] | None = None):
        super().__init__(name, help_text)
        self._values: dict[tuple, float] = {}
        self.collector = collector

    def set(self, value: float, **labels: str) -> None:
        with self._lock:
            self._values[tuple(sorted(labels.items()))] = value

    def render(self) -> Iterable[str]:
        yield from self.header()
        values = self.collector() if self.collector else self._values
        for key, value in values.items():
            yield f"{self.name}{_labels(dict(key))} {value}"


class Histogram(_Metric):
    kind = "histogram"

    def __init__(self, name: str, help_text: str, buckets: tuple[float, ...] = DEFAULT_BUCKETS) -> None:
        super().__init__(name, help_text)
        self.buckets = buckets
        self._data: dict[tuple, list[float]] = {}  # bucket counts..., sum, count

    def observe(self, value: float, **labels: str) -> None:
        key = tuple(sorted(labels.items()))
        with self._lock:
            data = self._data.setdefault(key, [0.0] * (len(self.buckets) + 2))
            for i, bound in enumerate(self.buckets):
                if value <= bound:
                    data[i] += 1
            data[-2] += value
            data[-1] += 1

    def render(self) -> Iterable[str]:
        yield from self.header()
        for key, data in self._data.items():
            labels = dict(key)
            for i, bound in enumerate(self.buckets):
                yield f"{self.name}_bucket{_labels({**labels, 'le': str(bound)})} {data[i]}"
            yield f"{self.name}_bucket{_labels({**labels, 'le': '+Inf'})} {data[-1]}"
            yield f"{self.name}_sum{_labels(labels)} {data[-2]}"
            yield f"{self.name}_count{_labels(labels)} {data[-1]}"


class PlatformMetrics:
    def __init__(self) -> None:
        self.http_requests = Counter("aap_http_requests_total", "HTTP requests by route and status")
        self.http_latency = Histogram("aap_http_request_duration_seconds", "HTTP request latency")
        self.executions = Counter("aap_executions_total", "Executions by final status")
        self.execution_latency = Histogram("aap_execution_duration_seconds", "End-to-end execution latency")
        self.steps = Counter("aap_steps_total", "Workflow steps by capability, agent and status")
        self.step_latency = Histogram("aap_step_duration_seconds", "Workflow step latency")
        self.step_retries = Counter("aap_step_retries_total", "Step retry attempts")
        self.agent_calls = Counter("aap_agent_invocations_total", "Agent invocations by agent and outcome")
        self.tool_calls = Counter("aap_tool_calls_total", "Tool calls by tool and status")
        self.llm_requests = Counter("aap_llm_requests_total", "LLM requests by provider, model, outcome")
        self.llm_tokens = Counter("aap_llm_tokens_total", "LLM tokens by provider, model and type")
        self.llm_cost = Counter("aap_llm_cost_usd_total", "Estimated LLM cost in USD")
        self.llm_latency = Histogram("aap_llm_request_duration_seconds", "LLM latency")
        self.policy_denials = Counter("aap_policy_denials_total", "Policy denials by policy")
        self.guardrail_findings = Counter("aap_guardrail_findings_total", "Guardrail findings")
        self.registry_agents = Gauge("aap_registry_agents", "Registered agents by status and health")
        self._all = [v for v in vars(self).values() if isinstance(v, _Metric)]

    def render(self) -> str:
        lines: list[str] = []
        for metric in self._all:
            lines.extend(metric.render())
        return "\n".join(lines) + "\n"
