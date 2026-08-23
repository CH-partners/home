from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class NoticePayload(BaseModel):
    title: str = Field(default="공지 제목", max_length=300)
    date: str = Field(default="", max_length=20)
    html: str = ""


class SharedPagesResponse(BaseModel):
    menus: list[Any] = Field(default_factory=list)
    notice: dict[str, Any] = Field(default_factory=dict)
    page_contents: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime | None = None


class PageContentResponse(BaseModel):
    key: str
    content: dict[str, Any] = Field(default_factory=dict)


class PageContentPayload(BaseModel):
    content: dict[str, Any] = Field(default_factory=dict)
