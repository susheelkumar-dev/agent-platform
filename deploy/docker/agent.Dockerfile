# Generic image for the example agents in this repo:
#   docker build -f deploy/docker/agent.Dockerfile --build-arg AGENT_DIR=examples/agents/inventory_agent -t inventory-agent .
# Agents generated with `agentctl create` ship their own Dockerfile.
FROM python:3.12-slim AS build
WORKDIR /src
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir build && python -m build --wheel --outdir /dist

FROM python:3.12-slim
ARG AGENT_DIR
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LOG_FORMAT=json
WORKDIR /app
COPY --from=build /dist/*.whl /tmp/
# Base install only: agent services need the SDK, not the platform's database/LLM dependencies.
RUN pip install --no-cache-dir /tmp/*.whl && rm -f /tmp/*.whl
COPY ${AGENT_DIR}/ ./
RUN useradd --create-home --uid 10001 agent && chown -R agent /app
USER agent
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health').status==200 else 1)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
