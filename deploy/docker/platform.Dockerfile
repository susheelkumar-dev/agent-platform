# Platform server image. Build from the repository root:
#   docker build -f deploy/docker/platform.Dockerfile -t agent-platform:1.0.0 .
FROM python:3.12-slim AS build
WORKDIR /src
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir build && python -m build --wheel --outdir /dist

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000 LOG_FORMAT=json
WORKDIR /app
COPY --from=build /dist/*.whl /tmp/
RUN WHEEL=$(ls /tmp/*.whl) && pip install --no-cache-dir "${WHEEL}[platform,langgraph]" && rm -f /tmp/*.whl
COPY alembic.ini ./
COPY migrations ./migrations
RUN useradd --create-home --uid 10001 platform && mkdir -p /app/data && chown -R platform /app
USER platform
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
# Run `alembic upgrade head` as a release step (or set AUTO_CREATE_SCHEMA=true for dev).
CMD ["uvicorn", "platform_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-access-log"]
