from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.group_review import GroupReviewProject, GroupReviewSheet
from app.models.user import AppUser


def _active_workers(db: Session) -> list[AppUser]:
    stmt = (
        select(AppUser)
        .where(AppUser.role == "WORKER", AppUser.active.is_(True))
        .order_by(AppUser.id.asc())
    )
    return list(db.scalars(stmt).all())


def create_project_with_worker_sheets(
    db: Session,
    *,
    name: str,
    current_user: AppUser,
) -> tuple[GroupReviewProject, list[GroupReviewSheet]]:
    workers = _active_workers(db)
    if not workers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="활성 작업자가 없어 프로젝트를 생성할 수 없습니다.",
        )

    member_names = [worker.display_name for worker in workers]
    project = GroupReviewProject(
        id=str(uuid4()),
        name=name,
        members=member_names,
        completed=False,
        created_by=current_user.display_name,
        created_by_email=None,
    )

    sheets = [
        GroupReviewSheet(
            project_id=project.id,
            member_name=worker.display_name,
            type="member",
            completed=False,
            review_completed=False,
            reuse_requested=False,
        )
        for worker in workers
    ]

    try:
        db.add(project)
        db.add_all(sheets)
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(project)
    for sheet in sheets:
        db.refresh(sheet)
    return project, sheets


def list_projects(db: Session) -> list[GroupReviewProject]:
    stmt = select(GroupReviewProject).order_by(
        GroupReviewProject.created_at.desc().nullslast(),
        GroupReviewProject.id.desc(),
    )
    return list(db.scalars(stmt).all())


def get_project(db: Session, project_id: str) -> GroupReviewProject:
    project = db.get(GroupReviewProject, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def list_project_sheets(db: Session, project_id: str) -> list[GroupReviewSheet]:
    get_project(db, project_id)
    stmt = (
        select(GroupReviewSheet)
        .where(GroupReviewSheet.project_id == project_id)
        .order_by(GroupReviewSheet.id.asc())
    )
    return list(db.scalars(stmt).all())


def get_worker_sheet(
    db: Session,
    *,
    project_id: str,
    current_user: AppUser,
) -> GroupReviewSheet:
    project = get_project(db, project_id)
    if current_user.display_name not in (project.members or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access denied")

    stmt = select(GroupReviewSheet).where(
        GroupReviewSheet.project_id == project_id,
        GroupReviewSheet.member_name == current_user.display_name,
    )
    sheet = db.scalar(stmt)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet not found")
    return sheet
