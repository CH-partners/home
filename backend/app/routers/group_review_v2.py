from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_admin, require_worker_or_admin
from app.models.group_review import GroupReviewProject, GroupReviewSheet
from app.models.user import AppUser
from app.schemas.group_review_v2 import (
    GroupReviewProjectCreate,
    GroupReviewProjectCreatedResponse,
    GroupReviewProjectDetailResponse,
    GroupReviewProjectListItem,
    GroupReviewSheetResponse,
)
from app.services.group_review_v2 import (
    create_project_with_worker_sheets,
    get_project,
    get_worker_sheet,
    list_project_sheets,
    list_projects,
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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Worker role required",
        )
    return _sheet_response(
        get_worker_sheet(db, project_id=project_id, current_user=current_user)
    )
