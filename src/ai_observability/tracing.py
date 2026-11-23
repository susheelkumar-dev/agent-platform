"""Optional OpenTelemetry tracing.

If ``OTEL_ENABLED=true`` and the ``otel`` extra is installed, spans are
exported via OTLP (configure with the standard ``OTEL_EXPORTER_OTLP_*`` env
vars) and W3C ``traceparent`` headers are propagated to agent services.
Otherwise every call is a cheap no-op.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from typing import Any

logger = logging.getLogger("ai_observability.tracing")

_tracer: Any = None
_propagate: Any = None


def configure_tracing(enabled: bool, service_name: str) -> bool:
    global _tracer, _propagate
    if not enabled:
        return False
    try:
        from opentelemetry import propagate, trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        logger.warning("OTEL_ENABLED=true but opentelemetry packages are not installed (pip install .[otel])")
        return False
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer("ai-agent-platform")
    _propagate = propagate
    return True


@contextlib.contextmanager
def span(name: str, **attributes: Any) -> Iterator[Any]:
    if _tracer is None:
        yield None
        return
    with _tracer.start_as_current_span(name) as current:
        for key, value in attributes.items():
            if value is not None:
                current.set_attribute(key, value if isinstance(value, (str, int, float, bool)) else str(value))
        yield current


def inject_headers(headers: dict[str, str]) -> dict[str, str]:
    if _propagate is not None:
        _propagate.inject(headers)
    return headers
