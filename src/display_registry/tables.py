"""Registry tables. They share the platform's metadata (``ai_storage.tables.Base``) so the platform's Alembic
migrations create them; see ``migrations/versions/0002_display_registry.py``.

Ownership: every display and menu row belongs to the module that registered it. ``admin_overrides`` holds the
fields an administrator changed through the API; registration leaves those fields alone unless told otherwise.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKeyConstraint, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ai_storage.tables import Base, JSONType


class RegistryModuleRow(Base):
    __tablename__ = "registry_modules"

    app_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    module_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    version: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200), default="")
    owner: Mapped[str] = mapped_column(String(200), default="")
    checksum: Mapped[str] = mapped_column(String(64))
    manifest: Mapped[dict] = mapped_column(JSONType)
    registered_by: Mapped[str] = mapped_column(String(256))
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RegistryDisplayRow(Base):
    __tablename__ = "registry_displays"

    app_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    display_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    module_id: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(200))
    display_type: Mapped[str] = mapped_column(String(64))
    display_key: Mapped[str] = mapped_column(String(128))
    route: Mapped[str] = mapped_column(String(200))
    open_mode: Mapped[str] = mapped_column(String(16), default="tab")
    params: Mapped[list] = mapped_column(JSONType, default=list)
    required_permissions: Mapped[list] = mapped_column(JSONType, default=list)
    action_permissions: Mapped[dict] = mapped_column(JSONType, default=dict)
    icon: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    admin_overrides: Mapped[dict] = mapped_column(JSONType, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        ForeignKeyConstraint(["app_id", "module_id"], ["registry_modules.app_id", "registry_modules.module_id"]),
        Index("ux_registry_displays_route", "app_id", "route", unique=True),
    )


class RegistryMenuRow(Base):
    __tablename__ = "registry_menus"

    app_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    menu_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    module_id: Mapped[str] = mapped_column(String(128), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    display_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    params: Mapped[dict] = mapped_column(JSONType, default=dict)
    action: Mapped[str | None] = mapped_column(String(64), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    required_permissions: Mapped[list] = mapped_column(JSONType, default=list)
    admin_overrides: Mapped[dict] = mapped_column(JSONType, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        ForeignKeyConstraint(["app_id", "module_id"], ["registry_modules.app_id", "registry_modules.module_id"]),
        Index("ix_registry_menus_parent", "app_id", "parent_id"),
    )


class RegistryHistoryRow(Base):
    """One row per registration or admin change: who, when, what changed."""

    __tablename__ = "registry_history"

    history_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    app_id: Mapped[str] = mapped_column(String(128), index=True)
    module_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    action: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(256))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    report: Mapped[dict] = mapped_column(JSONType, default=dict)
