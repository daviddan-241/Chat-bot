"""Deployment records + environment variables."""
from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DeploymentProvider(str, enum.Enum):
    vercel = "vercel"
    railway = "railway"


class DeploymentStatus(str, enum.Enum):
    pending = "pending"
    building = "building"
    ready = "ready"
    error = "error"
    canceled = "canceled"


class Deployment(Base):
    __tablename__ = "deployments"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[DeploymentProvider] = mapped_column(
        SAEnum(DeploymentProvider, name="deployment_provider"), nullable=False
    )
    provider_deployment_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[DeploymentStatus] = mapped_column(
        SAEnum(DeploymentStatus, name="deployment_status"), nullable=False, default=DeploymentStatus.pending
    )
    url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logs: Mapped[str] = mapped_column(Text, nullable=False, default="")
    extra: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_deployments_project_provider", "project_id", "provider"),)


class EnvVar(Base):
    """Project-scoped environment variables. Value is encrypted-at-rest."""

    __tablename__ = "env_vars"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)  # encrypted
    environment: Mapped[str] = mapped_column(String(32), nullable=False, default="production")
    secret: Mapped[bool] = mapped_column(default=True)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("project_id", "key", "environment", name="uq_env_project_key_env"),)
