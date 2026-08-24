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


def _row_has_worker_value(row: GroupReviewRow) -> bool:
    return any(
        str(value or "").strip()
        for value in (
            row.collateral_no,
            row.sheet_label,
            row.field_no,
            row.change_before_text,
            row.change_after_text,
        )
    )


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


def _ensure_worker_sheet_mutable(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> GroupReviewSheet:
    sheet = _ensure_sheet_write_access(db, sheet_id=sheet_id, current_user=current_user)
    project = get_project(db, sheet.project_id)
    if project.completed or sheet.completed or sheet.review_completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sheet is read-only")
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
    _ensure_worker_sheet_mutable(db, sheet_id=sheet_id, current_user=current_user)
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
    sheet = _ensure_worker_sheet_mutable(db, sheet_id=row.sheet_id, current_user=current_user)
    if row.review_status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Row is read-only")

    for key, value in values.items():
        setattr(row, key, value)
    sheet.updated_at = datetime.now(timezone.utc)
    sheet.updated_by = current_user.display_name
    db.commit()
    db.refresh(row)
    return row


def approve_row(db: Session, *, row_id: int, current_user: AppUser) -> GroupReviewRow:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    row = db.get(GroupReviewRow, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Row not found")

    sheet = _ensure_sheet_read_access(db, sheet_id=row.sheet_id, current_user=current_user)
    project = get_project(db, sheet.project_id)
    if project.completed or sheet.review_completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Review is read-only")
    if not _row_has_worker_value(row):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="빈 행은 확인할 수 없습니다.")
    if row.review_status == "approved":
        return row
    if row.review_status not in {"draft", "submitted"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Row cannot be approved")

    row.review_status = "approved"
    row.checked = True
    row.reviewed_at = datetime.now(timezone.utc)
    row.reviewed_by_email = current_user.login_id
    sheet.updated_at = datetime.now(timezone.utc)
    sheet.updated_by = current_user.display_name
    db.commit()
    db.refresh(row)
    return row


def complete_worker_sheet(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> tuple[GroupReviewSheet, list[GroupReviewRow]]:
    sheet = _ensure_sheet_write_access(db, sheet_id=sheet_id, current_user=current_user)
    project = get_project(db, sheet.project_id)
    if project.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project is read-only")
    if sheet.review_completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Review is already completed")

    rows = list(
        db.scalars(
            select(GroupReviewRow)
            .where(GroupReviewRow.sheet_id == sheet_id)
            .order_by(GroupReviewRow.position.asc())
        ).all()
    )
    meaningful = [row for row in rows if _row_has_worker_value(row)]

    unresolved = [row for row in meaningful if row.review_status == "revision_requested"]
    if unresolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"재수정 요청 처리 중인 행이 {len(unresolved)}건 남아 있습니다.",
        )

    now = datetime.now(timezone.utc)
    for row in meaningful:
        if row.review_status == "draft":
            row.review_status = "submitted"
            row.submitted_at = now
            row.submitted_by = current_user.display_name

    sheet.completed = True
    sheet.reuse_requested = False
    sheet.reuse_requested_at = None
    sheet.reuse_requested_by = None
    sheet.reuse_requested_by_email = None
    sheet.updated_at = now
    sheet.updated_by = current_user.display_name
    db.commit()
    db.refresh(sheet)
    for row in rows:
        db.refresh(row)
    return sheet, rows


def request_sheet_reuse(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> GroupReviewSheet:
    sheet = _ensure_sheet_write_access(db, sheet_id=sheet_id, current_user=current_user)
    project = get_project(db, sheet.project_id)
    if project.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="프로젝트 완료 상태에서는 재사용 요청을 할 수 없습니다.")
    if not sheet.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="현재 시트는 이미 작업 가능한 상태입니다.")
    if sheet.reuse_requested:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 재사용 요청 중입니다.")

    now = datetime.now(timezone.utc)
    sheet.reuse_requested = True
    sheet.reuse_requested_at = now
    sheet.reuse_requested_by = current_user.display_name
    sheet.reuse_requested_by_email = current_user.login_id
    sheet.reuse_request_rejected_at = None
    sheet.reuse_request_rejected_by_email = None
    sheet.updated_at = now
    sheet.updated_by = current_user.display_name
    sheet.updated_by_email = current_user.login_id
    db.commit()
    db.refresh(sheet)
    return sheet


def approve_sheet_reuse(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> tuple[GroupReviewSheet, list[GroupReviewRow], int]:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    sheet = _ensure_sheet_read_access(db, sheet_id=sheet_id, current_user=current_user)
    project = get_project(db, sheet.project_id)
    if project.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="프로젝트 완료 상태에서는 재사용 승인할 수 없습니다.")
    if not sheet.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="현재 시트는 이미 작업 가능한 상태입니다.")
    if not sheet.reuse_requested:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="대기 중인 재사용 요청이 없습니다.")

    rows = list(
        db.scalars(
            select(GroupReviewRow)
            .where(GroupReviewRow.sheet_id == sheet_id)
            .order_by(GroupReviewRow.position.asc())
        ).all()
    )
    reopened_count = 0
    for row in rows:
        if row.review_status in {"approved", "revision_requested"}:
            continue
        if not _row_has_worker_value(row):
            continue
        reopened_count += 1
        row.checked = False
        row.review_status = "draft"
        row.submitted_at = None
        row.submitted_by = None
        row.reviewed_at = None
        row.reviewed_by_email = None

    now = datetime.now(timezone.utc)
    sheet.completed = False
    sheet.review_completed = False
    sheet.review_completed_at = None
    sheet.review_completed_by_email = None
    sheet.reuse_requested = False
    sheet.reuse_requested_at = None
    sheet.reuse_requested_by = None
    sheet.reuse_requested_by_email = None
    sheet.reuse_approved_at = now
    sheet.reuse_approved_by_email = current_user.login_id
    sheet.lock_session_id = None
    sheet.locked_by = None
    sheet.locked_at = None
    sheet.updated_at = now
    sheet.updated_by = current_user.display_name
    sheet.updated_by_email = current_user.login_id
    db.commit()
    db.refresh(sheet)
    for row in rows:
        db.refresh(row)
    return sheet, rows, reopened_count


def reject_sheet_reuse(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> GroupReviewSheet:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    sheet = _ensure_sheet_read_access(db, sheet_id=sheet_id, current_user=current_user)
    if not sheet.reuse_requested:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="대기 중인 재사용 요청이 없습니다.")

    now = datetime.now(timezone.utc)
    sheet.reuse_requested = False
    sheet.reuse_requested_at = None
    sheet.reuse_requested_by = None
    sheet.reuse_requested_by_email = None
    sheet.reuse_request_rejected_at = now
    sheet.reuse_request_rejected_by_email = current_user.login_id
    sheet.updated_at = now
    sheet.updated_by = current_user.display_name
    sheet.updated_by_email = current_user.login_id
    db.commit()
    db.refresh(sheet)
    return sheet


def complete_project(
    db: Session,
    *,
    project_id: str,
    current_user: AppUser,
) -> tuple[GroupReviewProject, list[GroupReviewSheet]]:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    project = get_project(db, project_id)
    if project.completed:
        return project, list_project_sheets(db, project_id)

    sheets = list_project_sheets(db, project_id)
    now = datetime.now(timezone.utc)

    for sheet in sheets:
        sheet.completed = True
        sheet.review_completed = True
        sheet.review_completed_at = now
        sheet.review_completed_by_email = current_user.login_id
        sheet.reuse_requested = False
        sheet.reuse_requested_at = None
        sheet.reuse_requested_by = None
        sheet.reuse_requested_by_email = None
        sheet.lock_session_id = None
        sheet.locked_by = None
        sheet.locked_at = None
        sheet.updated_at = now
        sheet.updated_by = current_user.display_name
        sheet.updated_by_email = current_user.login_id

    project.completed = True
    project.completed_at = now
    project.completed_by_email = current_user.login_id
    db.commit()
    db.refresh(project)
    for sheet in sheets:
        db.refresh(sheet)
    return project, sheets


def reopen_project(
    db: Session,
    *,
    project_id: str,
    current_user: AppUser,
) -> tuple[GroupReviewProject, list[GroupReviewSheet]]:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    project = get_project(db, project_id)
    sheets = list_project_sheets(db, project_id)
    now = datetime.now(timezone.utc)

    project.completed = False
    project.reopened_at = now
    project.reopened_by_email = current_user.login_id

    for sheet in sheets:
        if sheet.completed or sheet.review_completed:
            sheet.completed = False
            sheet.review_completed = False
            sheet.review_completed_at = None
            sheet.review_completed_by_email = None
            sheet.reuse_requested = False
            sheet.reuse_requested_at = None
            sheet.reuse_requested_by = None
            sheet.reuse_requested_by_email = None
            sheet.updated_at = now
            sheet.updated_by = current_user.display_name
            sheet.lock_session_id = None
            sheet.locked_by = None
            sheet.locked_at = None

    db.commit()
    db.refresh(project)
    for sheet in sheets:
        db.refresh(sheet)
    return project, sheets


def delete_row(db: Session, *, row_id: int, current_user: AppUser) -> None:
    row = db.get(GroupReviewRow, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Row not found")
    sheet = _ensure_worker_sheet_mutable(db, sheet_id=row.sheet_id, current_user=current_user)
    if row.review_status != "draft":
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
    sheet = _ensure_worker_sheet_mutable(db, sheet_id=sheet_id, current_user=current_user)

    rows = list(
        db.scalars(
            select(GroupReviewRow)
            .where(GroupReviewRow.sheet_id == sheet_id)
            .order_by(GroupReviewRow.position.asc())
        ).all()
    )
    if any(row.review_status != "draft" for row in rows):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Approved or submitted rows cannot be reordered")

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
