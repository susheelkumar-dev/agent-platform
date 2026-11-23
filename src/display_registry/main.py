"""Run the registry: ``display-registry`` (or ``python -m display_registry``)."""

from __future__ import annotations

import json
import logging
import sys


def run() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "schema":
        from .manifest import manifest_json_schema
        print(json.dumps(manifest_json_schema(), indent=2))
        return
    import uvicorn

    from .app import create_app
    from .settings import get_settings

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    run()
