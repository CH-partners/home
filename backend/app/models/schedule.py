from datetime import date, datetime, time

from sqlalchemy import CheckConstraint, Date, DateTime, Index, Text, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Schedule(Base):
    __tablename__ = "schedules"
    __table_args__ = (
        CheckConstraint(
            "start_time IS NULL OR end_time IS NULL OR start_time <= end_time",
            name="start_time_before_end_time",
        ),
        Index("ix_schedules_date", "date"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    memo: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    color: Mapped[str] = mapped_column(Text, nullable=False, server_default="#3b82f6")
    writer_email: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="anonymous",
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
