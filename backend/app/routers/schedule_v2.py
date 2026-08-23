from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_admin, require_worker_or_admin
from app.models.app_settings import AppSettings
from app.models.schedule import Schedule
from app.models.user import AppUser
from app.schemas.schedule import (
    ScheduleBootstrapPayload,
    ScheduleBootstrapResponse,
    ScheduleCreate,
    ScheduleResponse,
    ScheduleStatusResponse,
    ScheduleUpdate,
)


router = APIRouter(prefix="/api/v1/schedules", tags=["schedules"])
SETTINGS_ID = "main"
MIGRATION_STATE_KEY = "__local_schedule_migration__"


def _to_response(item: Schedule) -> ScheduleResponse:
    return ScheduleResponse(
        id=item.id,
        title=item.title,
        date=item.date,
        start_time=item.start_time,
        end_time=item.end_time,
        memo=item.memo,
        color=item.color,
        writer_email=item.writer_email,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _validate_times(payload: ScheduleCreate | ScheduleUpdate) -> None:
    if payload.start_time is not None and payload.end_time is not None and payload.start_time > payload.end_time:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="종료 시간이 시작 시간보다 빠를 수 없습니다.",
        )


def _migration_complete(db: Session) -> bool:
    settings = db.get(AppSettings, SETTINGS_ID)
    if settings is None:
        return False
    state = dict(settings.page_contents or {}).get(MIGRATION_STATE_KEY)
    return isinstance(state, dict) and state.get("complete") is True


def _mark_migration_complete(db: Session, imported: int) -> None:
    settings = db.get(AppSettings, SETTINGS_ID)
    if settings is None:
        settings = AppSettings(
            id=SETTINGS_ID,
            menus=[],
            notice={},
            page_contents={},
            updated_at=datetime.now(timezone.utc),
        )

    contents = dict(settings.page_contents or {})
    contents[MIGRATION_STATE_KEY] = {
        "complete": True,
        "imported": imported,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    settings.page_contents = contents
    settings.updated_at = datetime.now(timezone.utc)
    db.add(settings)


@router.get("/status", response_model=ScheduleStatusResponse)
def schedule_status(
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> ScheduleStatusResponse:
    count = int(db.scalar(select(func.count()).select_from(Schedule)) or 0)
    return ScheduleStatusResponse(
        count=count,
        migration_complete=_migration_complete(db),
    )


@router.get("", response_model=list[ScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> list[ScheduleResponse]:
    items = db.scalars(select(Schedule).order_by(Schedule.date.asc(), Schedule.start_time.asc(), Schedule.created_at.asc())).all()
    return [_to_response(item) for item in items]


@router.post("/bootstrap", response_model=ScheduleBootstrapResponse)
def bootstrap_schedules(
    payload: ScheduleBootstrapPayload,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
) -> ScheduleBootstrapResponse:
    if _migration_complete(db):
        count = int(db.scalar(select(func.count()).select_from(Schedule)) or 0)
        return ScheduleBootstrapResponse(imported=count, migration_complete=True)

    existing_id = db.scalar(select(Schedule.id).limit(1))
    if existing_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Local schedules already contain data before migration was confirmed.",
        )

    now = datetime.now(timezone.utc)
    seen_ids: set[str] = set()
    imported = 0

    for source in payload.items:
        source_id = source.source_id.strip()
        if source_id in seen_ids:
            continue
        seen_ids.add(source_id)
        _validate_times(source)
        item = Schedule(
            id=source_id,
            title=source.title.strip(),
            date=source.date,
            start_time=source.start_time,
            end_time=source.end_time,
            memo=source.memo,
            color=source.color,
            writer_email=source.writer_email or "anonymous",
            created_at=source.created_at or now,
            updated_at=source.updated_at or source.created_at or now,
        )
        db.add(item)
        imported += 1

    _mark_migration_complete(db, imported)
    db.commit()
    return ScheduleBootstrapResponse(imported=imported, migration_complete=True)


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    payload: ScheduleCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_worker_or_admin),
) -> ScheduleResponse:
    if not _migration_complete(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="기존 일정 이관 확인이 끝난 뒤 새 일정을 등록할 수 있습니다.",
        )

    _validate_times(payload)
    now = datetime.now(timezone.utc)
    item = Schedule(
        id=str(uuid4()),
        title=payload.title.strip(),
        date=payload.date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        memo=payload.memo,
        color=payload.color,
        writer_email=user.login_id,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_response(item)


@router.put("/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(
    schedule_id: str,
    payload: ScheduleUpdate,
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> ScheduleResponse:
    if not _migration_complete(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="기존 일정 이관 확인이 끝난 뒤 일정을 수정할 수 있습니다.",
        )

    _validate_times(payload)
    item = db.get(Schedule, schedule_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="일정을 찾을 수 없습니다.")

    item.title = payload.title.strip()
    item.date = payload.date
    item.start_time = payload.start_time
    item.end_time = payload.end_time
    item.memo = payload.memo
    item.color = payload.color
    item.updated_at = datetime.now(timezone.utc)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_response(item)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> None:
    if not _migration_complete(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="기존 일정 이관 확인이 끝난 뒤 일정을 삭제할 수 있습니다.",
        )

    item = db.get(Schedule, schedule_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="일정을 찾을 수 없습니다.")
    db.delete(item)
    db.commit()
