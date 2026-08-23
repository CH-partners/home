from __future__ import annotations

from datetime import date, datetime, time

from pydantic import BaseModel, Field


class ScheduleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    date: date
    start_time: time | None = None
    end_time: time | None = None
    memo: str = ""
    color: str = Field(default="#3b82f6", max_length=32)


class ScheduleUpdate(ScheduleCreate):
    pass


class ScheduleBootstrapItem(ScheduleCreate):
    source_id: str = Field(min_length=1, max_length=300)
    writer_email: str = Field(default="anonymous", max_length=300)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ScheduleBootstrapPayload(BaseModel):
    items: list[ScheduleBootstrapItem] = Field(default_factory=list, max_length=5000)


class ScheduleBootstrapResponse(BaseModel):
    imported: int
    migration_complete: bool = True


class ScheduleStatusResponse(BaseModel):
    count: int
    migration_complete: bool


class ScheduleResponse(BaseModel):
    id: str
    title: str
    date: date
    start_time: time | None = None
    end_time: time | None = None
    memo: str
    color: str
    writer_email: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
