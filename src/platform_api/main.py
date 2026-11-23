"""ASGI entry point: ``uvicorn platform_api.main:app`` (or the ``agent-platform`` command)."""

from __future__ import annotations

import os

from platform_api.app import create_app

app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run(
        "platform_api.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        proxy_headers=True,
        log_config=None,
    )


if __name__ == "__main__":
    run()
