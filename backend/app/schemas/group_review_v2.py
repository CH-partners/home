from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class GroupReviewCellStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fontSize: Literal[12, 13, 15, 18, 22] | None = None
    bold: bool | None = None
    strike: bool | None = None
    backgroundColor: str | None = Field(
        default=None,
        pattern=r"^(|#[0-9A-Fa-f]{6})$",
    )


class GroupReviewCellStyles(BaseModel):
    model_config = ConfigDict(extra="forbid")

    collateral_no: GroupReviewCellStyle | None = None
    sheet_label: GroupReviewCellStyle | None = None
    field_no: GroupReviewCellStyle | None = None
    change_before: GroupReviewCellStyle | None = None
    change_after: GroupReviewCellStyle | None = None


class GroupReviewRowCreate(BaseModel):
    collateral_no: str = ""
    sheet_label: str = ""
    field_no: str = ""
    change_before_text: str = ""
    change_after_text: str = ""
    cell_styles: GroupReviewCellStyles = Field(default_factory=GroupReviewCellStyles)


class GroupReviewRowUpdate(BaseModel):
    collateral_no: str | None = None
    sheet_label: str | None = None
    field_no: str | None = None
    change_before_text: str | None = None
    change_after_text: str | None = None
    cell_styles: GroupReviewCellStyles | None = None


class GroupReviewRowResponse(BaseModel):
    id: int
    sheet_id: int
    position: int
    collateral_no: str
    sheet_label: str
    field_no: str
    change_before_text: str
    change_after_text: str
    cell_styles: dict
    review_status: str
    revision_no: int


class GroupReviewRowOrderRequest(BaseModel):
    row_ids: list[int] = Field(min_length=0)

    @field_validator("row_ids")
    @classmethod
    def unique_row_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("row_ids에는 중복된 행 ID가 있을 수 없습니다.")
        return value
