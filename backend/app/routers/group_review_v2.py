from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_admin, require_worker_or_admin
from app.models.group_review import GroupReviewProject, GroupReviewRow, GroupReviewSheet
from app.models.user import AppUser
from app.schemas.group_review_v2 import (
    GroupReviewProjectCreate,
    GroupReviewProjectCreatedResponse,
    GroupReviewProjectDetailResponse,
    GroupReviewProjectListItem,
    GroupReviewRowCreate,
    GroupReviewRowOrderRequest,
    GroupReviewRowResponse,
    GroupReviewRowUpdate,
    GroupReviewSheetResponse,
)
from app.services.group_review_v2 import (
    create_project_with_worker_sheets,
    create_row,
    delete_row,
    get_project,
    get_worker_sheet,
    list_project_sheets,
    list_projects,
    list_rows,
    reorder_rows,
    update_row,
)

router = APIRouter(prefix="/api/v1/group-review", tags=["group-review-v2"])


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
        collateral_no=row.collateral_no,
        sheet_label=row.sheet_label,
        field_no=row.field_no,
        change_before_text=row.change_before_text,
        change_after_text=row.change_after_text,
        cell_styles=dict(row.cell_styles or {}),
        review_status=row.review_status,
        revision_no=row.revision_no,
    )


@router.post("/projects", response_model=GroupReviewProjectCreatedResponse, status_code=status.HTTP_201_CREATED)
def create_group_review_project(
    payload: GroupReviewProjectCreate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewProjectCreatedResponse:
    project, sheets = create_project_with_worker_sheets(
        db,
        name=payload.name,
        current_user=current_user,
    )
    return GroupReviewProjectCreatedResponse(
        id=project.id,
        name=project.name,
        completed=project.completed,
        members=list(project.members or []),
        sheet_count=len(sheets),
        created_at=project.created_at,
    )


@router.get("/projects", response_model=list[GroupReviewProjectListItem])
def get_group_review_projects(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewProjectListItem]:
    projects = list_projects(db)
    counts = dict(
        db.execute(
            select(GroupReviewSheet.project_id, func.count(GroupReviewSheet.id))
            .group_by(GroupReviewSheet.project_id)
        ).all()
    )
    return [
        GroupReviewProjectListItem(
            id=project.id,
            name=project.name,
            completed=project.completed,
            member_count=int(counts.get(project.id, len(project.members or []))),
            created_at=project.created_at,
        )
        for project in projects
    ]


@router.get("/projects/{project_id}", response_model=GroupReviewProjectDetailResponse)
def get_group_review_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewProjectDetailResponse:
    project = get_project(db, project_id)
    members = list(project.members or [])
    if current_user.role == "WORKER" and current_user.display_name not in members:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access denied")

    sheet_count = db.scalar(
        select(func.count(GroupReviewSheet.id)).where(GroupReviewSheet.project_id == project.id)
    ) or 0
    return GroupReviewProjectDetailResponse(
        id=project.id,
        name=project.name,
        completed=project.completed,
        members=members,
        member_count=len(members),
        sheet_count=int(sheet_count),
        created_at=project.created_at,
        created_by=project.created_by,
    )


@router.get("/projects/{project_id}/sheets", response_model=list[GroupReviewSheetResponse])
def get_group_review_sheets(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewSheetResponse]:
    if current_user.role == "ADMIN":
        sheets = list_project_sheets(db, project_id)
        return [_sheet_response(sheet) for sheet in sheets]

    sheet = get_worker_sheet(db, project_id=project_id, current_user=current_user)
    return [_sheet_response(sheet)]


@router.get("/projects/{project_id}/my-sheet", response_model=GroupReviewSheetResponse)
def get_my_group_review_sheet(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(get_current_user),
) -> GroupReviewSheetResponse:
    if current_user.role != "WORKER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker role required")
    return _sheet_response(get_worker_sheet(db, project_id=project_id, current_user=current_user))


@router.get("/sheets/{sheet_id}/rows", response_model=list[GroupReviewRowResponse])
def get_group_review_rows(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewRowResponse]:
    return [_row_response(row) for row in list_rows(db, sheet_id=sheet_id, current_user=current_user)]


@router.post("/sheets/{sheet_id}/rows", response_model=GroupReviewRowResponse, status_code=status.HTTP_201_CREATED)
def add_group_review_row(
    sheet_id: int,
    payload: GroupReviewRowCreate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewRowResponse:
    values = payload.model_dump()
    values["cell_styles"] = payload.cell_styles.model_dump(exclude_none=True)
    return _row_response(create_row(db, sheet_id=sheet_id, current_user=current_user, values=values))


@router.patch("/rows/{row_id}", response_model=GroupReviewRowResponse)
def patch_group_review_row(
    row_id: int,
    payload: GroupReviewRowUpdate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewRowResponse:
    values = payload.model_dump(exclude_unset=True)
    if payload.cell_styles is not None:
        values["cell_styles"] = payload.cell_styles.model_dump(exclude_none=True)
    return _row_response(update_row(db, row_id=row_id, current_user=current_user, values=values))


@router.delete("/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_group_review_row(
    row_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> Response:
    delete_row(db, row_id=row_id, current_user=current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/sheets/{sheet_id}/row-order", response_model=list[GroupReviewRowResponse])
def put_group_review_row_order(
    sheet_id: int,
    payload: GroupReviewRowOrderRequest,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewRowResponse]:
    rows = reorder_rows(db, sheet_id=sheet_id, row_ids=payload.row_ids, current_user=current_user)
    return [_row_response(row) for row in rows]
