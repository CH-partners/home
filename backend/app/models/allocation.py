from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AllocationState(Base):
    __tablename__ = "allocation_state"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    members: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    projects: Mapped[list[AllocationProject]] = relationship(
        back_populates="state",
        cascade="all, delete-orphan",
    )


class AllocationProject(Base):
    __tablename__ = "allocation_projects"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    state_id: Mapped[str] = mapped_column(
        ForeignKey("allocation_state.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    memo: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    columns: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    rows: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    state: Mapped[AllocationState] = relationship(back_populates="projects")
