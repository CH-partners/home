"""add single active session fields

Revision ID: 9d3f2a6b8c41
Revises: 7c1a4d9f2b60
Create Date: 2026-08-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9d3f2a6b8c41"
down_revision: Union[str, Sequence[str], None] = "7c1a4d9f2b60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_users", sa.Column("active_session_id", sa.Text(), nullable=True))
    op.add_column(
        "app_users",
        sa.Column("session_last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "app_users",
        sa.Column("session_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("app_users", "session_expires_at")
    op.drop_column("app_users", "session_last_seen_at")
    op.drop_column("app_users", "active_session_id")
