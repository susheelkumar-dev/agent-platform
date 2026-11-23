"""The AI Agent Platform server. ``create_app`` builds a self-contained FastAPI application."""


def create_app(*args, **kwargs):  # lazy import keeps ``import platform_api`` cheap
    from platform_api.app import create_app as _create_app

    return _create_app(*args, **kwargs)


__all__ = ["create_app"]
