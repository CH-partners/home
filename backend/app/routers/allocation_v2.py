from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_admin, require_worker_or_admin
from app.models.allocation import AllocationProject
from app.models.user import AppUser
from app.schemas.allocation_v2 import (
    AllocationGridUpdate,
    AllocationProjectCreate,
    AllocationProjectListItem,
    AllocationProjectResponse,
    AllocationProjectUpdate,
)
from app.services.allocation_v2 import (
    create_project,
    delete_project,
    get_project,
    list_projects,
    update_grid,
    update_project,
)

router = APIRouter(prefix="/api/v1/allocation", tags=["allocation-v2"])


def _project_response(project: AllocationProject) -> AllocationProjectResponse:
    columns = project.columns or []
    normalized_columns = []
    for index, column in enumerate(columns):
        if isinstance(column, dict):
            normalized_columns.append({
                "id": str(column.get("id") or f"col_{index + 1}"),
                "label": str(column.get("label") or column.get("name") or f"항목 {index + 1}"),
            })
        else:
            normalized_columns.append({"id": f"col_{index + 1}", "label": str(column)})

    rows = []
    for row in project.rows or []:
        if not isinstance(row, dict):
            continue
        values = row.get("values") or {}
        if normalized_columns and any(column["id"] not in values for column in normalized_columns):
            legacy_values = values
            values = {
                column["id"]: str(legacy_values.get(column["label"], legacy_values.get(column["id"], "")))
                for column in normalized_columns
            }
        rows.append({
            "name": str(row.get("name") or ""),
            "active": bool(row.get("active", True)),
            "values": values,
        })

    return AllocationProjectResponse(
        id=project.id,
        name=project.name,
        memo=project.memo or "",
        columns=normalized_columns,
        rows=rows,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("/projects", response_model=list[AllocationProjectListItem])
def get_projects(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_worker_or_admin),
) -> list[AllocationProjectListItem]:
    return [
        AllocationProjectListItem(
            id=project.id,
            name=project.name,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )
        for project in list_projects(db)
    ]


@router.get("/projects/{project_id}", response_model=AllocationProjectResponse)
def get_one_project(
    project_id: str,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_worker_or_admin),
) -> AllocationProjectResponse:
    return _project_response(get_project(db, project_id))


@router.post("/projects", response_model=AllocationProjectResponse, status_code=status.HTTP_201_CREATED)
def create_one_project(
    payload: AllocationProjectCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> AllocationProjectResponse:
    return _project_response(create_project(db, name=payload.name))


@router.patch("/projects/{project_id}", response_model=AllocationProjectResponse)
def patch_project(
    project_id: str,
    payload: AllocationProjectUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> AllocationProjectResponse:
    return _project_response(update_project(db, project_id=project_id, values=payload.model_dump(exclude_unset=True)))


@router.put("/projects/{project_id}/grid", response_model=AllocationProjectResponse)
def put_grid(
    project_id: str,
    payload: AllocationGridUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> AllocationProjectResponse:
    return _project_response(
        update_grid(
            db,
            project_id=project_id,
            columns=[column.model_dump() for column in payload.columns],
            rows=[row.model_dump() for row in payload.rows],
        )
    )


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project(
    project_id: str,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> Response:
    delete_project(db, project_id=project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
