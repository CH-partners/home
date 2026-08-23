from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_worker_or_admin
from app.models.schedule import Schedule
from app.models.user import AppUser
from app.schemas.schedule import ScheduleCreate, ScheduleResponse, ScheduleUpdate


router = APIRouter(prefix="/api/v1/schedules", tags=["schedules"])


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


@router.get("", response_model=list[ScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> list[ScheduleResponse]:
    items = db.scalars(select(Schedule).order_by(Schedule.date.asc(), Schedule.start_time.asc(), Schedule.created_at.asc())).all()
    return [_to_response(item) for item in items]


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    payload: ScheduleCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_worker_or_admin),
) -> ScheduleResponse:
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
    item = db.get(Schedule, schedule_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="일정을 찾을 수 없습니다.")
    db.delete(item)
    db.commit()
