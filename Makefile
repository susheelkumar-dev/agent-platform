PY ?= python
PORT ?= 8000

.PHONY: install test lint fmt run-platform run-inventory run-exposure dev migrate wheel compose-up compose-down openapi

install:
	pip install -e ".[dev]"

test:
	pytest -q

lint:
	ruff check src tests examples

fmt:
	ruff check --fix src tests examples

run-platform:
	$(PY) -m uvicorn platform_api.main:app --port $(PORT) --reload --reload-dir src

run-inventory:
	cd examples/agents/inventory_agent && AGENT_SERVICE_URL=http://127.0.0.1:8101 $(PY) main.py

run-exposure:
	cd examples/agents/exposure_agent && AGENT_SERVICE_URL=http://127.0.0.1:8102 $(PY) main.py

dev:
	./scripts/dev.sh

migrate:
	alembic upgrade head

wheel:
	$(PY) -m pip install build && $(PY) -m build --wheel

openapi:
	$(PY) -c "import json; from platform_api.app import create_app; from ai_core.config import Settings; \
	json.dump(create_app(Settings(database_url='memory'), configure_logs=False).openapi(), open('docs/api/openapi.json','w'), indent=2)"

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down -v
