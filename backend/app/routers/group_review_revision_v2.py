from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_admin, require_worker_or_admin
from app.models.group_review import GroupReviewProject, GroupReviewRow, GroupReviewSheet
from app.models.user import AppUser
from app.realtime.group_review_v2 import manager
from app.schemas.group_review_v2 import (
    GroupReviewProjectDetailResponse,
    GroupReviewRevisionRequestResponse,
    GroupReviewRowResponse,
    GroupReviewSheetResponse,
)
from app.services.group_review_revision_v2 import (
    complete_project_revision_aware,
    complete_worker_sheet_revision_aware,
    request_row_revision,
)
from app.services.group_review_v2 import list_rows

router = APIRouter(prefix="/api/v1/group-review", tags=["group-review-revision-v2"])


def _sheet_response(sheet: GroupReviewSheet) -> GroupReviewSheetResponse:
    return GroupReviewSheetResponse(
        id=sheet.id,
        project_id=sheet.project_id,
        member_name=sheet.member_name,
        completed=sheet.completed,
        review_completed=sheet.review_completed,
        reuse_requested=sheet.reuse_requested,
    )


def _row_response(row: GroupReviewRow) -> GroupReviewRowResponse:
    return GroupReviewRowResponse(
        id=row.id,
        sheet_id=row.sheet_id,
        position=row.position,
        parent_revision_row_id=row.parent_revision_row_id,
        collateral_no=row.collateral_no,
        sheet_label=row.sheet_label,
        field_no=row.field_no,
        change_before_text=row.change_before_text,
        change_after_text=row.change_after_text,
        cell_styles=dict(row.cell_styles or {}),
        review_status=row.review_status,
        revision_no=row.revision_no,
    )


def _project_response(project: GroupReviewProject, sheets: list[GroupReviewSheet]) -> GroupReviewProjectDetailResponse:
    return GroupReviewProjectDetailResponse(
        id=project.id,
        name=project.name,
        completed=project.completed,
        members=list(project.members or []),
        member_count=len(project.members or []),
        sheet_count=len(sheets),
        created_at=project.created_at,
        created_by=project.created_by,
    )


@router.get("/sheets/{sheet_id}/revision-rows", response_model=list[GroupReviewRowResponse])
def get_revision_rows(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewRowResponse]:
    return [_row_response(row) for row in list_rows(db, sheet_id=sheet_id, current_user=current_user)]


@router.post("/rows/{row_id}/revision-request", response_model=GroupReviewRevisionRequestResponse)
async def request_revision(
    row_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewRevisionRequestResponse:
    sheet, parent, child = request_row_revision(db, row_id=row_id, current_user=current_user)
    payload = GroupReviewRevisionRequestResponse(
        sheet=_sheet_response(sheet),
        parent_row=_row_response(parent),
        child_row=_row_response(child),
    )
    await manager.broadcast(sheet.project_id, {
        "type": "revision_requested",
        "sheet_id": sheet.id,
        "sheet": payload.sheet.model_dump(),
        "parent_row": payload.parent_row.model_dump(),
        "child_row": payload.child_row.model_dump(),
        "actor_login_id": current_user.login_id,
    })
    return payload


@router.post("/sheets/{sheet_id}/complete-revision-aware", response_model=GroupReviewSheetResponse)
async def complete_revision_sheet(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewSheetResponse:
    sheet, rows = complete_worker_sheet_revision_aware(db, sheet_id=sheet_id, current_user=current_user)
    await manager.broadcast(sheet.project_id, {
        "type": "sheet_completed",
        "sheet": _sheet_response(sheet).model_dump(),
        "rows": [_row_response(row).model_dump() for row in rows],
        "actor_login_id": current_user.login_id,
    })
    return _sheet_response(sheet)


@router.post("/projects/{project_id}/complete-revision-aware", response_model=GroupReviewProjectDetailResponse)
async def complete_revision_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewProjectDetailResponse:
    project, sheets = complete_project_revision_aware(db, project_id=project_id, current_user=current_user)
    response = _project_response(project, sheets)
    await manager.broadcast(project_id, {
        "type": "project_completed",
        "project": response.model_dump(mode="json"),
        "sheets": [_sheet_response(sheet).model_dump() for sheet in sheets],
        "actor_login_id": current_user.login_id,
    })
    return response
