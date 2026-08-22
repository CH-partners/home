from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_session_token
from app.db.session import get_db, get_session_factory
from app.dependencies.auth import get_current_user, require_admin, require_worker_or_admin
from app.models.group_review import GroupReviewProject, GroupReviewRow, GroupReviewSheet
from app.models.user import AppUser
from app.realtime.group_review_v2 import manager
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
    approve_row,
    approve_sheet_reuse,
    complete_project,
    complete_worker_sheet,
    create_project_with_worker_sheets,
    create_row,
    delete_row,
    get_project,
    get_worker_sheet,
    list_project_sheets,
    list_projects,
    list_rows,
    reject_sheet_reuse,
    reopen_project,
    reorder_rows,
    request_sheet_reuse,
    update_row,
)

router = APIRouter(prefix="/api/v1/group-review", tags=["group-review-v2"])

EDITABLE_CELL_FIELDS = {
    "collateral_no",
    "sheet_label",
    "field_no",
    "change_before_text",
    "change_after_text",
}


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


def _row_payload(row: GroupReviewRow) -> dict:
    return _row_response(row).model_dump()


def _project_detail(db: Session, project: GroupReviewProject) -> GroupReviewProjectDetailResponse:
    members = list(project.members or [])
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


def _project_id_for_sheet(db: Session, sheet_id: int) -> str:
    sheet = db.get(GroupReviewSheet, sheet_id)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet not found")
    return sheet.project_id


def _websocket_user(websocket: WebSocket) -> AppUser | None:
    settings = get_settings()
    token = websocket.cookies.get(settings.auth_cookie_name)
    if not token:
        return None
    try:
        payload = decode_session_token(token)
        user_id = int(payload["sub"])
    except Exception:
        return None

    session_factory = get_session_factory()
    with session_factory() as db:
        user = db.get(AppUser, user_id)
        if user is None or not user.active:
            return None
        db.expunge(user)
        return user


def _websocket_project_allowed(project_id: str, user: AppUser) -> bool:
    session_factory = get_session_factory()
    with session_factory() as db:
        project = db.get(GroupReviewProject, project_id)
        if project is None:
            return False
        if user.role == "ADMIN":
            return True
        return user.role == "WORKER" and user.display_name in (project.members or [])


def _cell_lock_allowed(
    project_id: str,
    user: AppUser,
    *,
    sheet_id: int,
    row_id: int,
    field_name: str,
) -> bool:
    if user.role != "WORKER" or field_name not in EDITABLE_CELL_FIELDS:
        return False

    session_factory = get_session_factory()
    with session_factory() as db:
        sheet = db.get(GroupReviewSheet, sheet_id)
        row = db.get(GroupReviewRow, row_id)
        project = db.get(GroupReviewProject, project_id)
        if not sheet or not row or not project:
            return False
        if sheet.project_id != project_id or row.sheet_id != sheet_id:
            return False
        if sheet.member_name != user.display_name:
            return False
        if project.completed or sheet.completed or sheet.review_completed:
            return False
        return row.review_status == "draft"


@router.post("/projects", response_model=GroupReviewProjectCreatedResponse, status_code=status.HTTP_201_CREATED)
def create_group_review_project(
    payload: GroupReviewProjectCreate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewProjectCreatedResponse:
    project, sheets = create_project_with_worker_sheets(db, name=payload.name, current_user=current_user)
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
    return _project_detail(db, project)


@router.get("/projects/{project_id}/sheets", response_model=list[GroupReviewSheetResponse])
def get_group_review_sheets(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewSheetResponse]:
    project = get_project(db, project_id)
    if current_user.role == "WORKER" and current_user.display_name not in (project.members or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access denied")
    return [_sheet_response(sheet) for sheet in list_project_sheets(db, project_id)]


@router.get("/projects/{project_id}/my-sheet", response_model=GroupReviewSheetResponse)
def get_my_group_review_sheet(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(get_current_user),
) -> GroupReviewSheetResponse:
    if current_user.role != "WORKER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker role required")
    return _sheet_response(get_worker_sheet(db, project_id=project_id, current_user=current_user))


@router.post("/sheets/{sheet_id}/complete", response_model=GroupReviewSheetResponse)
async def complete_group_review_sheet(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewSheetResponse:
    sheet, rows = complete_worker_sheet(db, sheet_id=sheet_id, current_user=current_user)
    await manager.broadcast(sheet.project_id, {
        "type": "sheet_completed",
        "sheet": _sheet_response(sheet).model_dump(),
        "rows": [_row_payload(row) for row in rows],
        "actor_login_id": current_user.login_id,
    })
    return _sheet_response(sheet)


@router.post("/sheets/{sheet_id}/reuse-request", response_model=GroupReviewSheetResponse)
async def request_group_review_sheet_reuse(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewSheetResponse:
    sheet = request_sheet_reuse(db, sheet_id=sheet_id, current_user=current_user)
    await manager.broadcast(sheet.project_id, {
        "type": "reuse_requested",
        "sheet": _sheet_response(sheet).model_dump(),
        "actor_login_id": current_user.login_id,
    })
    return _sheet_response(sheet)


@router.post("/sheets/{sheet_id}/reuse-approve", response_model=GroupReviewSheetResponse)
async def approve_group_review_sheet_reuse(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewSheetResponse:
    sheet, rows, reopened_count = approve_sheet_reuse(db, sheet_id=sheet_id, current_user=current_user)
    await manager.broadcast(sheet.project_id, {
        "type": "reuse_approved",
        "sheet": _sheet_response(sheet).model_dump(),
        "rows": [_row_payload(row) for row in rows],
        "reopened_count": reopened_count,
        "actor_login_id": current_user.login_id,
    })
    return _sheet_response(sheet)


@router.post("/sheets/{sheet_id}/reuse-reject", response_model=GroupReviewSheetResponse)
async def reject_group_review_sheet_reuse(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewSheetResponse:
    sheet = reject_sheet_reuse(db, sheet_id=sheet_id, current_user=current_user)
    await manager.broadcast(sheet.project_id, {
        "type": "reuse_rejected",
        "sheet": _sheet_response(sheet).model_dump(),
        "actor_login_id": current_user.login_id,
    })
    return _sheet_response(sheet)


@router.post("/projects/{project_id}/complete", response_model=GroupReviewProjectDetailResponse)
async def complete_group_review_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewProjectDetailResponse:
    project, sheets = complete_project(db, project_id=project_id, current_user=current_user)
    await manager.broadcast(project_id, {
        "type": "project_completed",
        "project": _project_detail(db, project).model_dump(mode="json"),
        "sheets": [_sheet_response(sheet).model_dump() for sheet in sheets],
        "actor_login_id": current_user.login_id,
    })
    return _project_detail(db, project)


@router.post("/projects/{project_id}/reopen", response_model=GroupReviewProjectDetailResponse)
async def reopen_group_review_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewProjectDetailResponse:
    project, sheets = reopen_project(db, project_id=project_id, current_user=current_user)
    await manager.broadcast(project_id, {
        "type": "project_reopened",
        "project": _project_detail(db, project).model_dump(mode="json"),
        "sheets": [_sheet_response(sheet).model_dump() for sheet in sheets],
        "actor_login_id": current_user.login_id,
    })
    return _project_detail(db, project)


@router.get("/sheets/{sheet_id}/rows", response_model=list[GroupReviewRowResponse])
def get_group_review_rows(
    sheet_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewRowResponse]:
    return [_row_response(row) for row in list_rows(db, sheet_id=sheet_id, current_user=current_user)]


@router.post("/sheets/{sheet_id}/rows", response_model=GroupReviewRowResponse, status_code=status.HTTP_201_CREATED)
async def add_group_review_row(
    sheet_id: int,
    payload: GroupReviewRowCreate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewRowResponse:
    values = payload.model_dump()
    values["cell_styles"] = payload.cell_styles.model_dump(exclude_none=True)
    row = create_row(db, sheet_id=sheet_id, current_user=current_user, values=values)
    project_id = _project_id_for_sheet(db, sheet_id)
    await manager.broadcast(project_id, {
        "type": "row_upserted",
        "sheet_id": sheet_id,
        "row": _row_payload(row),
        "actor_login_id": current_user.login_id,
    })
    return _row_response(row)


@router.patch("/rows/{row_id}", response_model=GroupReviewRowResponse)
async def patch_group_review_row(
    row_id: int,
    payload: GroupReviewRowUpdate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> GroupReviewRowResponse:
    values = payload.model_dump(exclude_unset=True)
    if payload.cell_styles is not None:
        values["cell_styles"] = payload.cell_styles.model_dump(exclude_none=True)
    row = update_row(db, row_id=row_id, current_user=current_user, values=values)
    project_id = _project_id_for_sheet(db, row.sheet_id)
    await manager.broadcast(project_id, {
        "type": "row_upserted",
        "sheet_id": row.sheet_id,
        "row": _row_payload(row),
        "actor_login_id": current_user.login_id,
    })
    return _row_response(row)


@router.post("/rows/{row_id}/approve", response_model=GroupReviewRowResponse)
async def approve_group_review_row(
    row_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
) -> GroupReviewRowResponse:
    row = approve_row(db, row_id=row_id, current_user=current_user)
    project_id = _project_id_for_sheet(db, row.sheet_id)
    await manager.broadcast(project_id, {
        "type": "row_approved",
        "sheet_id": row.sheet_id,
        "row": _row_payload(row),
        "actor_login_id": current_user.login_id,
    })
    return _row_response(row)


@router.delete("/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_group_review_row(
    row_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> Response:
    row = db.get(GroupReviewRow, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Row not found")
    sheet_id = row.sheet_id
    project_id = _project_id_for_sheet(db, sheet_id)
    delete_row(db, row_id=row_id, current_user=current_user)
    await manager.broadcast(project_id, {
        "type": "row_deleted",
        "sheet_id": sheet_id,
        "row_id": row_id,
        "actor_login_id": current_user.login_id,
    })
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/sheets/{sheet_id}/row-order", response_model=list[GroupReviewRowResponse])
async def put_group_review_row_order(
    sheet_id: int,
    payload: GroupReviewRowOrderRequest,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> list[GroupReviewRowResponse]:
    rows = reorder_rows(db, sheet_id=sheet_id, row_ids=payload.row_ids, current_user=current_user)
    project_id = _project_id_for_sheet(db, sheet_id)
    await manager.broadcast(project_id, {
        "type": "rows_reordered",
        "sheet_id": sheet_id,
        "rows": [_row_payload(row) for row in rows],
        "actor_login_id": current_user.login_id,
    })
    return [_row_response(row) for row in rows]


@router.websocket("/ws/projects/{project_id}")
async def group_review_project_websocket(websocket: WebSocket, project_id: str) -> None:
    user = _websocket_user(websocket)
    if user is None or not _websocket_project_allowed(project_id, user):
        await websocket.close(code=4401)
        return

    connection_id = await manager.connect(project_id, websocket)
    await websocket.send_json({
        "type": "connected",
        "project_id": project_id,
        "login_id": user.login_id,
        "display_name": user.display_name,
        "role": user.role,
        "connection_id": connection_id,
        "locks": manager.list_locks(project_id),
    })

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            message_type = message.get("type")
            if message_type == "cell_lock_request":
                try:
                    sheet_id = int(message.get("sheet_id"))
                    row_id = int(message.get("row_id"))
                except (TypeError, ValueError):
                    continue
                field_name = str(message.get("field_name") or "")
                request_id = str(message.get("request_id") or "")

                if not _cell_lock_allowed(
                    project_id,
                    user,
                    sheet_id=sheet_id,
                    row_id=row_id,
                    field_name=field_name,
                ):
                    await websocket.send_json({
                        "type": "cell_lock_denied",
                        "request_id": request_id,
                        "reason": "not_editable",
                    })
                    continue

                acquired, lock = manager.acquire_cell_lock(
                    project_id,
                    websocket,
                    sheet_id=sheet_id,
                    row_id=row_id,
                    field_name=field_name,
                    login_id=user.login_id,
                    display_name=user.display_name,
                )
                if not acquired:
                    await websocket.send_json({
                        "type": "cell_lock_denied",
                        "request_id": request_id,
                        "reason": "locked",
                        "lock": lock,
                    })
                    continue

                await websocket.send_json({
                    "type": "cell_lock_granted",
                    "request_id": request_id,
                    "lock": lock,
                })
                await manager.broadcast(
                    project_id,
                    {"type": "cell_locked", "lock": lock},
                    exclude=websocket,
                )

            elif message_type == "cell_unlock":
                try:
                    sheet_id = int(message.get("sheet_id"))
                    row_id = int(message.get("row_id"))
                except (TypeError, ValueError):
                    continue
                field_name = str(message.get("field_name") or "")
                released = manager.release_cell_lock(
                    project_id,
                    websocket,
                    sheet_id=sheet_id,
                    row_id=row_id,
                    field_name=field_name,
                )
                if released:
                    await manager.broadcast(
                        project_id,
                        {"type": "cell_unlocked", "lock": released},
                        exclude=websocket,
                    )

            elif message_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        released = manager.disconnect(project_id, websocket)
        for lock in released:
            await manager.broadcast(
                project_id,
                {"type": "cell_unlocked", "lock": lock, "reason": "connection_closed"},
            )
    except Exception:
        released = manager.disconnect(project_id, websocket)
        for lock in released:
            await manager.broadcast(
                project_id,
                {"type": "cell_unlocked", "lock": lock, "reason": "connection_closed"},
            )
        try:
            await websocket.close()
        except Exception:
            pass
