"""integrations, deployments, preferences, embeddings

Revision ID: 0002_integrations
Revises: 0001_init
Create Date: 2026-06-02 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_integrations"
down_revision: Union[str, None] = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DO $$ BEGIN CREATE TYPE integration_provider AS ENUM ('github','google','vercel','railway'); EXCEPTION WHEN duplicate_object THEN null; END $$;"))
    bind.execute(sa.text("DO $$ BEGIN CREATE TYPE deployment_provider AS ENUM ('vercel','railway'); EXCEPTION WHEN duplicate_object THEN null; END $$;"))
    bind.execute(sa.text("DO $$ BEGIN CREATE TYPE deployment_status AS ENUM ('pending','building','ready','error','canceled'); EXCEPTION WHEN duplicate_object THEN null; END $$;"))

    op.create_table(
        "integrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", postgresql.ENUM("github", "google", "vercel", "railway", name="integration_provider", create_type=False), nullable=False),
        sa.Column("access_token", sa.Text, nullable=False),
        sa.Column("refresh_token", sa.Text, nullable=True),
        sa.Column("scope", sa.String(512), nullable=True),
        sa.Column("account_id", sa.String(128), nullable=True),
        sa.Column("account_login", sa.String(255), nullable=True),
        sa.Column("account_email", sa.String(255), nullable=True),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column("extra", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "provider", name="uq_integration_user_provider"),
    )
    op.create_index("ix_integrations_user", "integrations", ["user_id"])

    op.create_table(
        "repo_imports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False, server_default="github"),
        sa.Column("repo_full_name", sa.String(255), nullable=False),
        sa.Column("branch", sa.String(255), nullable=False, server_default="main"),
        sa.Column("last_sha", sa.String(64), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("files_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("extra", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_repo_imports_user", "repo_imports", ["user_id"])
    op.create_index("ix_repo_imports_project", "repo_imports", ["project_id"])
    op.create_index("ix_repo_imports_project_repo", "repo_imports", ["project_id", "repo_full_name"])

    op.create_table(
        "deployments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", postgresql.ENUM("vercel", "railway", name="deployment_provider", create_type=False), nullable=False),
        sa.Column("provider_deployment_id", sa.String(255), nullable=True),
        sa.Column("status", postgresql.ENUM("pending", "building", "ready", "error", "canceled", name="deployment_status", create_type=False), nullable=False, server_default="pending"),
        sa.Column("url", sa.String(512), nullable=True),
        sa.Column("branch", sa.String(255), nullable=True),
        sa.Column("commit_sha", sa.String(64), nullable=True),
        sa.Column("logs", sa.Text, nullable=False, server_default=""),
        sa.Column("extra", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_deployments_user", "deployments", ["user_id"])
    op.create_index("ix_deployments_project", "deployments", ["project_id"])
    op.create_index("ix_deployments_project_provider", "deployments", ["project_id", "provider"])

    op.create_table(
        "env_vars",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("environment", sa.String(32), nullable=False, server_default="production"),
        sa.Column("secret", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "key", "environment", name="uq_env_project_key_env"),
    )
    op.create_index("ix_env_vars_project", "env_vars", ["project_id"])

    op.create_table(
        "user_preferences",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("theme", sa.String(32), nullable=False, server_default="dark"),
        sa.Column("default_model", sa.String(128), nullable=True),
        sa.Column("default_system_prompt", sa.Text, nullable=True),
        sa.Column("preferences", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "project_memory",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("importance", sa.Float, nullable=False, server_default="0.5"),
        sa.Column("extra", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "key", name="uq_project_memory_key"),
    )
    op.create_index("ix_project_memory_project", "project_memory", ["project_id"])
    op.create_index("ix_project_memory_user", "project_memory", ["user_id"])

    op.create_table(
        "memory_embeddings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("ref_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("embedding", postgresql.ARRAY(sa.Float), nullable=False),
        sa.Column("dim", sa.Integer, nullable=False, server_default="0"),
        sa.Column("model", sa.String(64), nullable=False, server_default="hash-256"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("scope", "ref_id", name="uq_memory_embedding_ref"),
    )
    op.create_index("ix_memory_embeddings_user", "memory_embeddings", ["user_id"])
    op.create_index("ix_memory_embeddings_scope_ref", "memory_embeddings", ["scope", "ref_id"])
    op.create_index("ix_memory_embeddings_project", "memory_embeddings", ["project_id"])
    op.create_index("ix_memory_embeddings_ref_id", "memory_embeddings", ["ref_id"])


def downgrade() -> None:
    for t in ["memory_embeddings", "project_memory", "user_preferences", "env_vars",
              "deployments", "repo_imports", "integrations"]:
        op.drop_table(t)
    for enum_name in ["deployment_status", "deployment_provider", "integration_provider"]:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
