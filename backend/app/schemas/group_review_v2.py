from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class GroupReviewProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("프로젝트명은 비워둘 수 없습니다.")
        return normalized


class GroupReviewProjectCreatedResponse(BaseModel):
    id: str
    name: str
    completed: bool
    members: list[str]
    sheet_count: int
    created_at: datetime | None


class GroupReviewProjectListItem(BaseModel):
    id: str
    name: str
    completed: bool
    member_count: int
    created_at: datetime | None


class GroupReviewProjectDetailResponse(BaseModel):
    id: str
    name: str
    completed: bool
    members: list[str]
    member_count: int
    sheet_count: int
    created_at: datetime | None
    created_by: str | None


class GroupReviewSheetResponse(BaseModel):
    id: int
    project_id: str
    member_name: str
    completed: bool
    review_completed: bool
    reuse_requested: bool
