from datetime import datetime

from sqlalchemy import DateTime, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EditLog(Base):
    __tablename__ = "edit_logs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    action: Mapped[str] = mapped_column(Text, nullable=False)
    user_email: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="unknown",
    )
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


Index("ix_edit_logs_time_desc", EditLog.time.desc())
