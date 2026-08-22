from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.group_review import GroupReviewProject, GroupReviewRow, GroupReviewSheet
from app.models.user import AppUser


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


def _sheet_rows(db: Session, sheet_id: int) -> list[GroupReviewRow]:
    return list(
        db.scalars(
            select(GroupReviewRow)
            .where(GroupReviewRow.sheet_id == sheet_id)
            .order_by(GroupReviewRow.position.asc())
        ).all()
    )


def unresolved_revision_parents(rows: list[GroupReviewRow]) -> list[GroupReviewRow]:
    children_by_parent: dict[int, list[GroupReviewRow]] = {}
    for row in rows:
        if row.parent_revision_row_id is not None:
            children_by_parent.setdefault(row.parent_revision_row_id, []).append(row)

    unresolved: list[GroupReviewRow] = []
    for row in rows:
        if row.review_status != "revision_requested":
            continue
        children = children_by_parent.get(row.id, [])
        if not children:
            unresolved.append(row)
            continue
        latest = max(children, key=lambda child: (child.revision_no, child.id))
        if latest.review_status == "draft":
            unresolved.append(row)
    return unresolved


def effective_revision_leaves(rows: list[GroupReviewRow]) -> list[GroupReviewRow]:
    parent_ids = {row.parent_revision_row_id for row in rows if row.parent_revision_row_id is not None}
    return [row for row in rows if row.id not in parent_ids and _row_has_worker_value(row)]


def request_row_revision(
    db: Session,
    *,
    row_id: int,
    current_user: AppUser,
) -> tuple[GroupReviewSheet, GroupReviewRow, GroupReviewRow]:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    parent = db.get(GroupReviewRow, row_id)
    if parent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Row not found")

    sheet = db.get(GroupReviewSheet, parent.sheet_id)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet not found")
    project = db.get(GroupReviewProject, sheet.project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="프로젝트 완료 상태에서는 재수정 요청할 수 없습니다.")
    if parent.review_status not in {"submitted", "approved"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="검토대기 또는 확인완료 행만 재수정 요청할 수 있습니다.")

    existing_child = db.scalar(
        select(GroupReviewRow)
        .where(
            GroupReviewRow.parent_revision_row_id == parent.id,
            GroupReviewRow.review_status == "draft",
        )
        .order_by(GroupReviewRow.revision_no.desc(), GroupReviewRow.id.desc())
    )
    if existing_child is not None:
        return sheet, parent, existing_child

    rows = _sheet_rows(db, sheet.id)
    insert_position = parent.position + 1
    offset = len(rows) + 2
    for row in rows:
        if row.position >= insert_position:
            row.position += offset
    db.flush()
    for row in rows:
        if row.position >= insert_position + offset:
            row.position -= offset - 1

    now = datetime.now(timezone.utc)
    parent.review_status = "revision_requested"
    parent.checked = False
    parent.revision_requested_at = now
    parent.revision_requested_by_email = current_user.login_id

    child = GroupReviewRow(
        sheet_id=sheet.id,
        firestore_row_id=str(uuid4()),
        position=insert_position,
        parent_revision_row_id=parent.id,
        parent_revision_firestore_row_id=parent.firestore_row_id,
        collateral_no=parent.collateral_no,
        sheet_label=parent.sheet_label,
        field_no=parent.field_no,
        checked=False,
        change_before_text="",
        change_before_html="",
        change_after_text="",
        change_after_html="",
        cell_styles={},
        review_status="draft",
        revision_no=parent.revision_no + 1,
    )
    db.add(child)

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
    sheet.updated_by_email = current_user.login_id

    db.commit()
    db.refresh(sheet)
    db.refresh(parent)
    db.refresh(child)
    return sheet, parent, child


def complete_worker_sheet_revision_aware(
    db: Session,
    *,
    sheet_id: int,
    current_user: AppUser,
) -> tuple[GroupReviewSheet, list[GroupReviewRow]]:
    sheet = db.get(GroupReviewSheet, sheet_id)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet not found")
    if current_user.role != "WORKER" or sheet.member_name != current_user.display_name:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Own sheet required")
    project = db.get(GroupReviewProject, sheet.project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project is read-only")
    if sheet.review_completed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Review is already completed")

    rows = _sheet_rows(db, sheet_id)
    meaningful = [row for row in rows if _row_has_worker_value(row)]
    if not meaningful:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="입력된 리뷰 행이 없습니다.")

    unresolved = unresolved_revision_parents(rows)
    if unresolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"재수정 요청 처리 중인 행이 {len(unresolved)}건 남아 있습니다.",
        )

    now = datetime.now(timezone.utc)
    for row in effective_revision_leaves(rows):
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


def complete_project_revision_aware(
    db: Session,
    *,
    project_id: str,
    current_user: AppUser,
) -> tuple[GroupReviewProject, list[GroupReviewSheet]]:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    project = db.get(GroupReviewProject, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    sheets = list(
        db.scalars(
            select(GroupReviewSheet)
            .where(GroupReviewSheet.project_id == project_id)
            .order_by(GroupReviewSheet.id.asc())
        ).all()
    )
    if project.completed:
        return project, sheets

    relevant: list[GroupReviewSheet] = []
    incomplete_names: list[str] = []
    reuse_pending_names: list[str] = []
    unapproved: list[tuple[str, int]] = []
    for sheet in sheets:
        rows = _sheet_rows(db, sheet.id)
        leaves = effective_revision_leaves(rows)
        is_relevant = sheet.completed or sheet.review_completed or bool(leaves)
        if not is_relevant:
            continue
        relevant.append(sheet)
        if not sheet.completed:
            incomplete_names.append(sheet.member_name)
        if sheet.reuse_requested:
            reuse_pending_names.append(sheet.member_name)
        pending_count = sum(1 for row in leaves if row.review_status != "approved")
        if pending_count:
            unapproved.append((sheet.member_name, pending_count))

    if not relevant:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="완료할 리뷰 데이터가 없습니다.")
    if reuse_pending_names:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="재사용 요청 대기 중인 작업자: " + ", ".join(reuse_pending_names))
    if incomplete_names:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="입력 완료되지 않은 작업자: " + ", ".join(incomplete_names))
    if unapproved:
        detail = ", ".join(f"{name} {count}건" for name, count in unapproved)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="관리자 확인이 남아 있습니다: " + detail)

    now = datetime.now(timezone.utc)
    for sheet in relevant:
        sheet.review_completed = True
        sheet.review_completed_at = now
        sheet.review_completed_by_email = current_user.login_id
        sheet.updated_at = now
        sheet.updated_by = current_user.display_name
        sheet.lock_session_id = None
        sheet.locked_by = None
        sheet.locked_at = None

    project.completed = True
    project.completed_at = now
    project.completed_by_email = current_user.login_id
    db.commit()
    db.refresh(project)
    for sheet in sheets:
        db.refresh(sheet)
    return project, sheets
