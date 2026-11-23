#!/usr/bin/env bash
# Start the platform and both example agents locally; Ctrl+C stops everything.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDS=()
cleanup() { kill "${PIDS[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT" && python -m uvicorn platform_api.main:app --port 8000) & PIDS+=($!)
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:8000/ready >/dev/null 2>&1 && break; sleep 0.5; done
(cd "$ROOT/examples/agents/inventory_agent" && AGENT_SERVICE_URL=http://127.0.0.1:8101 python main.py) & PIDS+=($!)
(cd "$ROOT/examples/agents/exposure_agent" && AGENT_SERVICE_URL=http://127.0.0.1:8102 python main.py) & PIDS+=($!)
echo "Platform: http://127.0.0.1:8000  (agents on :8101, :8102)"
wait
