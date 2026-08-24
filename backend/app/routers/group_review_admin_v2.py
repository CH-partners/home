from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_admin
from app.models.group_review import GroupReviewProject
from app.models.user import AppUser
from app.services.group_review_images import delete_project_image_tree


router = APIRouter(prefix="/api/v1/group-review", tags=["group-review-admin-v2"])


@router.delete("/projects", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_group_review_projects(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> Response:
    projects = list(db.scalars(select(GroupReviewProject)).all())
    project_ids = [project.id for project in projects]

    try:
        for project in projects:
            db.delete(project)
        db.commit()
    except Exception:
        db.rollback()
        raise

    for project_id in project_ids:
        delete_project_image_tree(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group_review_project(
    project_id: str,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> Response:
    project = db.get(GroupReviewProject, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="그룹리뷰 프로젝트를 찾을 수 없습니다.",
        )

    db.delete(project)
    db.commit()
    delete_project_image_tree(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
