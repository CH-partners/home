from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class AllocationColumn(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)

    @field_validator("id", "label")
    @classmethod
    def trim_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("빈 값은 사용할 수 없습니다.")
        return value


class AllocationRow(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    active: bool = True
    values: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("이름은 비워둘 수 없습니다.")
        return value


class AllocationProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("프로젝트명은 비워둘 수 없습니다.")
        return value


class AllocationProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    memo: str | None = Field(default=None, max_length=1000)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("프로젝트명은 비워둘 수 없습니다.")
        return value


class AllocationGridUpdate(BaseModel):
    columns: list[AllocationColumn]
    rows: list[AllocationRow]


class AllocationProjectResponse(BaseModel):
    id: str
    name: str
    memo: str
    columns: list[AllocationColumn]
    rows: list[AllocationRow]
    created_at: datetime | None
    updated_at: datetime | None


class AllocationProjectListItem(BaseModel):
    id: str
    name: str
    created_at: datetime | None
    updated_at: datetime | None
