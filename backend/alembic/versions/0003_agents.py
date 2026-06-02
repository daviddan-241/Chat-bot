"""agents + chat.agent_id

Revision ID: 0003_agents
Revises: 0002_integrations
Create Date: 2026-06-02 03:00:00.000000
"""
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_agents"
down_revision: Union[str, None] = "0002_integrations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("icon", sa.String(32), nullable=False, server_default="Sparkles"),
        sa.Column("color", sa.String(32), nullable=False, server_default="indigo"),
        sa.Column("provider", sa.String(32), nullable=False, server_default="auto"),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("system_prompt", sa.Text, nullable=False, server_default=""),
        sa.Column("temperature", sa.Float, nullable=False, server_default="0.7"),
        sa.Column("tools", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("capabilities", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("examples", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("is_builtin", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("is_public", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="100"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slug", "user_id", name="uq_agent_slug_user"),
    )
    op.create_index("ix_agents_user_id", "agents", ["user_id"])
    op.create_index("ix_agents_public_default", "agents", ["is_public", "is_default"])

    op.add_column(
        "chats",
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agents.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_chats_agent_id", "chats", ["agent_id"])


def downgrade() -> None:
    op.drop_index("ix_chats_agent_id", table_name="chats")
    op.drop_column("chats", "agent_id")
    op.drop_index("ix_agents_public_default", table_name="agents")
    op.drop_index("ix_agents_user_id", table_name="agents")
    op.drop_table("agents")
