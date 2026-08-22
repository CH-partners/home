from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.allocation import AllocationProject, AllocationState
from app.models.user import AppUser

STATE_ID = "default"


def _state(db: Session) -> AllocationState:
    state = db.get(AllocationState, STATE_ID)
    if state is None:
        state = AllocationState(id=STATE_ID, members=[], updated_at=datetime.now(timezone.utc))
        db.add(state)
        db.flush()
    return state


def _active_workers(db: Session) -> list[AppUser]:
    stmt = (
        select(AppUser)
        .where(AppUser.role == "WORKER", AppUser.active.is_(True))
        .order_by(AppUser.id.asc())
    )
    return list(db.scalars(stmt).all())


def list_projects(db: Session) -> list[AllocationProject]:
    stmt = select(AllocationProject).where(AllocationProject.state_id == STATE_ID).order_by(
        AllocationProject.created_at.asc().nullslast(),
        AllocationProject.name.asc(),
    )
    return list(db.scalars(stmt).all())


def get_project(db: Session, project_id: str) -> AllocationProject:
    project = db.get(AllocationProject, project_id)
    if project is None or project.state_id != STATE_ID:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="분배표 프로젝트를 찾을 수 없습니다.")
    return project


def create_project(db: Session, *, name: str) -> AllocationProject:
    duplicate = db.scalar(
        select(AllocationProject).where(
            AllocationProject.state_id == STATE_ID,
            AllocationProject.name == name,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="같은 프로젝트명이 이미 있습니다.")

    state = _state(db)
    workers = _active_workers(db)
    if not workers:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="활성 작업자가 없습니다.")

    now = datetime.now(timezone.utc)
    state.members = [worker.display_name for worker in workers]
    state.updated_at = now
    project = AllocationProject(
        id=str(uuid4()),
        state_id=STATE_ID,
        name=name,
        memo="",
        columns=[],
        rows=[{"name": worker.display_name, "values": {}} for worker in workers],
        created_at=now,
        updated_at=now,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def update_project(db: Session, *, project_id: str, values: dict) -> AllocationProject:
    project = get_project(db, project_id)
    if "name" in values and values["name"] != project.name:
        duplicate = db.scalar(
            select(AllocationProject).where(
                AllocationProject.state_id == STATE_ID,
                AllocationProject.name == values["name"],
                AllocationProject.id != project.id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="같은 프로젝트명이 이미 있습니다.")
    for key, value in values.items():
        setattr(project, key, value)
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project


def update_grid(db: Session, *, project_id: str, columns: list[dict], rows: list[dict]) -> AllocationProject:
    project = get_project(db, project_id)
    column_ids = [column["id"] for column in columns]
    if len(column_ids) != len(set(column_ids)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="열 ID가 중복되었습니다.")
    labels = [column["label"] for column in columns]
    if len(labels) != len(set(labels)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="같은 항목명이 있습니다.")
    names = [row["name"] for row in rows]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="작업자 이름이 중복되었습니다.")

    allowed = set(column_ids)
    normalized_rows = []
    for row in rows:
        normalized_rows.append({
            "name": row["name"],
            "values": {key: str(value) for key, value in row.get("values", {}).items() if key in allowed},
        })

    project.columns = columns
    project.rows = normalized_rows
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, *, project_id: str) -> None:
    project = get_project(db, project_id)
    db.delete(project)
    db.commit()
