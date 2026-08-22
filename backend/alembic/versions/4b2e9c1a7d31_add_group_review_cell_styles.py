"""add group review cell styles

Revision ID: 4b2e9c1a7d31
Revises: 599060c4e057
Create Date: 2026-08-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "4b2e9c1a7d31"
down_revision: Union[str, Sequence[str], None] = "599060c4e057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "group_review_rows",
        sa.Column(
            "cell_styles",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("group_review_rows", "cell_styles")
