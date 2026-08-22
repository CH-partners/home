from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.group_review import GroupReviewProject, GroupReviewRow, GroupReviewSheet
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
        created_at=datetime.now(timezone.utc),
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


def _ensure_sheet_read_access(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> GroupReviewSheet:
    sheet = db.get(GroupReviewSheet, sheet_id)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet not found")

    project = get_project(db, sheet.project_id)
    if current_user.role == "ADMIN":
        return sheet

    if current_user.role != "WORKER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sheet access denied")
    if current_user.display_name not in (project.members or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access denied")
    return sheet


def _ensure_sheet_write_access(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> GroupReviewSheet:
    sheet = _ensure_sheet_read_access(db, sheet_id=sheet_id, current_user=current_user)
    if current_user.role != "WORKER" or sheet.member_name != current_user.display_name:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Own sheet required")
    return sheet


def list_rows(db: Session, *, sheet_id: int, current_user: AppUser) -> list[GroupReviewRow]:
    _ensure_sheet_read_access(db, sheet_id=sheet_id, current_user=current_user)
    stmt = (
        select(GroupReviewRow)
        .where(GroupReviewRow.sheet_id == sheet_id)
        .order_by(GroupReviewRow.position.asc())
    )
    return list(db.scalars(stmt).all())


def create_row(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
    values: dict,
) -> GroupReviewRow:
    sheet = _ensure_sheet_write_access(db, sheet_id=sheet_id, current_user=current_user)
    if sheet.completed or sheet.review_completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sheet is read-only")

    existing = list_rows(db, sheet_id=sheet_id, current_user=current_user)
    row = GroupReviewRow(
        sheet_id=sheet_id,
        firestore_row_id=str(uuid4()),
        position=len(existing),
        collateral_no=values.get("collateral_no", ""),
        sheet_label=values.get("sheet_label", ""),
        field_no=values.get("field_no", ""),
        change_before_text=values.get("change_before_text", ""),
        change_after_text=values.get("change_after_text", ""),
        cell_styles=values.get("cell_styles", {}),
        review_status="draft",
        revision_no=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_row(
    db: Session,
    *,
    row_id: int,
    current_user: AppUser,
    values: dict,
) -> GroupReviewRow:
    row = db.get(GroupReviewRow, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Row not found")
    sheet = _ensure_sheet_write_access(db, sheet_id=row.sheet_id, current_user=current_user)
    if sheet.completed or sheet.review_completed or row.review_status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Row is read-only")

    for key, value in values.items():
        setattr(row, key, value)
    sheet.updated_at = datetime.now(timezone.utc)
    sheet.updated_by = current_user.display_name
    db.commit()
    db.refresh(row)
    return row


def delete_row(db: Session, *, row_id: int, current_user: AppUser) -> None:
    row = db.get(GroupReviewRow, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Row not found")
    sheet = _ensure_sheet_write_access(db, sheet_id=row.sheet_id, current_user=current_user)
    if sheet.completed or sheet.review_completed or row.review_status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Row is read-only")

    remaining = list(
        db.scalars(
            select(GroupReviewRow)
            .where(GroupReviewRow.sheet_id == row.sheet_id, GroupReviewRow.id != row.id)
            .order_by(GroupReviewRow.position.asc())
        ).all()
    )
    db.delete(row)
    db.flush()
    for index, item in enumerate(remaining):
        item.position = index
    sheet.updated_at = datetime.now(timezone.utc)
    sheet.updated_by = current_user.display_name
    db.commit()


def reorder_rows(
    db: Session,
    *,
    sheet_id: int,
    row_ids: list[int],
    current_user: AppUser,
) -> list[GroupReviewRow]:
    sheet = _ensure_sheet_write_access(db, sheet_id=sheet_id, current_user=current_user)
    if sheet.completed or sheet.review_completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sheet is read-only")

    rows = list(
        db.scalars(
            select(GroupReviewRow)
            .where(GroupReviewRow.sheet_id == sheet_id)
            .order_by(GroupReviewRow.position.asc())
        ).all()
    )
    current_ids = [row.id for row in rows]
    if set(row_ids) != set(current_ids) or len(row_ids) != len(current_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="row_ids must include every row exactly once")

    by_id = {row.id: row for row in rows}
    offset = len(rows) + 1
    for row in rows:
        row.position = row.position + offset
    db.flush()
    for index, row_id in enumerate(row_ids):
        by_id[row_id].position = index
    sheet.updated_at = datetime.now(timezone.utc)
    sheet.updated_by = current_user.display_name
    db.commit()

    return [by_id[row_id] for row_id in row_ids]
