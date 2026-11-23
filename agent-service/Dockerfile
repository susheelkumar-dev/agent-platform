# syntax=docker/dockerfile:1
# Agent service: FastAPI + LangGraph. Multi-stage: wheels are built in the first stage, the runtime stage has no
# compiler, runs as a non-root user and binds the port the platform gives it ($PORT on Azure Container Apps and
# Render; 8000 otherwise).

FROM python:3.11-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.txt .
RUN pip wheel --wheel-dir /wheels -r requirements.txt

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENVIRONMENT=production \
    PORT=8000
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build /wheels /wheels
RUN pip install --no-index --find-links /wheels /wheels/* && rm -rf /wheels
COPY --chown=app:app agentsvc/ ./agentsvc/
COPY --chown=app:app data/ ./data/
COPY --chown=app:app main.py ./
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/health', timeout=2)"
# one worker: the service is I/O bound (LLM + DB calls) and must stay small; scale out with replicas instead
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --timeout-keep-alive 75"]
