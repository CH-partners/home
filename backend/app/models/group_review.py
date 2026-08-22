from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class GroupReviewProject(Base):
    __tablename__ = "group_review_projects"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    members: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    completed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by_email: Mapped[str | None] = mapped_column(Text)
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reopened_by_email: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str | None] = mapped_column(Text)
    created_by_email: Mapped[str | None] = mapped_column(Text)
    raw_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    sheets: Mapped[list[GroupReviewSheet]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class GroupReviewSheet(Base):
    __tablename__ = "group_review_sheets"
    __table_args__ = (
        UniqueConstraint("project_id", "member_name"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(),
        primary_key=True,
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("group_review_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    member_name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False, server_default="member")
    completed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    review_completed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    review_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_completed_by_email: Mapped[str | None] = mapped_column(Text)
    reuse_requested: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    reuse_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reuse_requested_by: Mapped[str | None] = mapped_column(Text)
    reuse_requested_by_email: Mapped[str | None] = mapped_column(Text)
    reuse_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reuse_approved_by_email: Mapped[str | None] = mapped_column(Text)
    reuse_request_rejected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    reuse_request_rejected_by_email: Mapped[str | None] = mapped_column(Text)
    lock_session_id: Mapped[str | None] = mapped_column(Text)
    locked_by: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column(Text)
    updated_by_email: Mapped[str | None] = mapped_column(Text)

    project: Mapped[GroupReviewProject] = relationship(back_populates="sheets")
    rows: Mapped[list[GroupReviewRow]] = relationship(
        back_populates="sheet",
        cascade="all, delete-orphan",
        foreign_keys="GroupReviewRow.sheet_id",
    )


class GroupReviewRow(Base):
    __tablename__ = "group_review_rows"
    __table_args__ = (
        UniqueConstraint("sheet_id", "firestore_row_id"),
        UniqueConstraint("sheet_id", "position"),
        CheckConstraint("position >= 0", name="position_nonnegative"),
        CheckConstraint("revision_no >= 1", name="revision_no_positive"),
        CheckConstraint(
            "review_status IN ('draft', 'submitted', 'approved', 'revision_requested')",
            name="review_status_allowed",
        ),
        Index("ix_group_review_rows_sheet_id_review_status", "sheet_id", "review_status"),
        Index(
            "ix_group_review_rows_parent_revision_firestore_row_id",
            "parent_revision_firestore_row_id",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(),
        primary_key=True,
    )
    sheet_id: Mapped[int] = mapped_column(
        ForeignKey("group_review_sheets.id", ondelete="CASCADE"),
        nullable=False,
    )
    firestore_row_id: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_revision_row_id: Mapped[int | None] = mapped_column(
        ForeignKey("group_review_rows.id", ondelete="SET NULL")
    )
    parent_revision_firestore_row_id: Mapped[str | None] = mapped_column(Text)
    collateral_no: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    sheet_label: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    field_no: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    checked: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    change_before_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="",
    )
    change_before_html: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="",
    )
    change_after_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="",
    )
    change_after_html: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="",
    )
    cell_styles: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    review_status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="draft",
    )
    revision_no: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_by: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_email: Mapped[str | None] = mapped_column(Text)
    revision_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    revision_requested_by_email: Mapped[str | None] = mapped_column(Text)
    raw_row: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    sheet: Mapped[GroupReviewSheet] = relationship(
        back_populates="rows",
        foreign_keys=[sheet_id],
    )
    parent_revision: Mapped[GroupReviewRow | None] = relationship(
        remote_side=[id],
        foreign_keys=[parent_revision_row_id],
    )
