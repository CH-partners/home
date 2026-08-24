from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_worker_or_admin
from app.models.group_review import GroupReviewProject, GroupReviewRow, GroupReviewSheet
from app.models.user import AppUser
from app.realtime.group_review_v2 import manager
from app.services.group_review_images import (
    detect_image_mime,
    delete_image_file,
    image_file_path,
    write_image_atomic,
)
from app.services.group_review_v2 import update_row


router = APIRouter(prefix="/api/v1/group-review", tags=["group-review-images"])

STYLE_KEY_TO_FIELD = {
    "collateral_no": "collateral_no",
    "sheet_label": "sheet_label",
    "field_no": "field_no",
    "change_before": "change_before_text",
    "change_after": "change_after_text",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MIN_IMAGE_WIDTH = 80
MAX_IMAGE_WIDTH = 1600


def _image_meta(row: GroupReviewRow, style_key: str) -> dict | None:
    style = dict((row.cell_styles or {}).get(style_key) or {})
    image = style.get("image")
    return dict(image) if isinstance(image, dict) else None


def _row_payload(row: GroupReviewRow) -> dict:
    return {
        "id": row.id,
        "sheet_id": row.sheet_id,
        "position": row.position,
        "collateral_no": row.collateral_no,
        "sheet_label": row.sheet_label,
        "field_no": row.field_no,
        "change_before_text": row.change_before_text,
        "change_after_text": row.change_after_text,
        "cell_styles": dict(row.cell_styles or {}),
        "review_status": row.review_status,
        "revision_no": row.revision_no,
    }


def _require_row_read_access(
    db: Session,
    *,
    row_id: int,
    current_user: AppUser,
) -> tuple[GroupReviewRow, GroupReviewSheet, GroupReviewProject]:
    row = db.get(GroupReviewRow, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Row not found")
    sheet = db.get(GroupReviewSheet, row.sheet_id)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet not found")
    project = db.get(GroupReviewProject, sheet.project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if current_user.role == "ADMIN":
        return row, sheet, project
    if current_user.role != "WORKER" or current_user.display_name not in (project.members or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access denied")
    return row, sheet, project


async def _broadcast_row(project_id: str, row: GroupReviewRow, current_user: AppUser) -> None:
    await manager.broadcast(project_id, {
        "type": "row_upserted",
        "sheet_id": row.sheet_id,
        "row": _row_payload(row),
        "actor_login_id": current_user.login_id,
    })


@router.put("/rows/{row_id}/cells/{style_key}/image")
async def put_group_review_cell_image(
    row_id: int,
    style_key: str,
    body: bytes = Body(media_type="application/octet-stream"),
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> dict:
    if style_key not in STYLE_KEY_TO_FIELD:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cell not found")
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="이미지 데이터가 없습니다.")
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="이미지는 10MB 이하만 사용할 수 있습니다.")

    row, sheet, project = _require_row_read_access(db, row_id=row_id, current_user=current_user)
    if current_user.role != "WORKER" or sheet.member_name != current_user.display_name:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Own sheet required")

    mime_type = detect_image_mime(body)
    if mime_type is None:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="PNG, JPG, WebP 이미지만 사용할 수 있습니다.")

    old_meta = _image_meta(row, style_key)
    image_id = uuid4().hex
    path = write_image_atomic(
        body,
        project_id=project.id,
        sheet_id=sheet.id,
        row_id=row.id,
        style_key=style_key,
        image_id=image_id,
        mime_type=mime_type,
    )

    styles = {key: dict(value or {}) for key, value in dict(row.cell_styles or {}).items()}
    cell_style = styles.setdefault(style_key, {})
    cell_style["image"] = {
        "id": image_id,
        "mimeType": mime_type,
        "width": 320,
        "size": len(body),
    }

    try:
        updated = update_row(db, row_id=row.id, current_user=current_user, values={"cell_styles": styles})
    except Exception:
        path.unlink(missing_ok=True)
        raise

    if old_meta:
        delete_image_file(
            project_id=project.id,
            sheet_id=sheet.id,
            row_id=row.id,
            style_key=style_key,
            image_id=str(old_meta.get("id") or ""),
            mime_type=str(old_meta.get("mimeType") or ""),
        )

    await _broadcast_row(project.id, updated, current_user)
    return {
        "row_id": updated.id,
        "style_key": style_key,
        "image": dict((updated.cell_styles or {}).get(style_key, {}).get("image") or {}),
    }


@router.get("/rows/{row_id}/cells/{style_key}/image")
def get_group_review_cell_image(
    row_id: int,
    style_key: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> FileResponse:
    if style_key not in STYLE_KEY_TO_FIELD:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cell not found")

    row, sheet, project = _require_row_read_access(db, row_id=row_id, current_user=current_user)
    meta = _image_meta(row, style_key)
    if not meta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    try:
        path = image_file_path(
            project_id=project.id,
            sheet_id=sheet.id,
            row_id=row.id,
            style_key=style_key,
            image_id=str(meta.get("id") or ""),
            mime_type=str(meta.get("mimeType") or ""),
        )
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return FileResponse(path, media_type=str(meta.get("mimeType") or "application/octet-stream"))


@router.patch("/rows/{row_id}/cells/{style_key}/image-size")
async def patch_group_review_cell_image_size(
    row_id: int,
    style_key: str,
    width: int = Body(embed=True),
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> dict:
    if style_key not in STYLE_KEY_TO_FIELD:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cell not found")
    width = max(MIN_IMAGE_WIDTH, min(MAX_IMAGE_WIDTH, int(width)))

    row, _, project = _require_row_read_access(db, row_id=row_id, current_user=current_user)
    styles = {key: dict(value or {}) for key, value in dict(row.cell_styles or {}).items()}
    cell_style = styles.setdefault(style_key, {})
    image = dict(cell_style.get("image") or {})
    if not image.get("id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    image["width"] = width
    cell_style["image"] = image

    updated = update_row(db, row_id=row.id, current_user=current_user, values={"cell_styles": styles})
    await _broadcast_row(project.id, updated, current_user)
    return {
        "row_id": updated.id,
        "style_key": style_key,
        "image": dict((updated.cell_styles or {}).get(style_key, {}).get("image") or {}),
    }


@router.delete("/rows/{row_id}/cells/{style_key}/image", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group_review_cell_image(
    row_id: int,
    style_key: str,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_worker_or_admin),
) -> Response:
    if style_key not in STYLE_KEY_TO_FIELD:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cell not found")

    row, sheet, project = _require_row_read_access(db, row_id=row_id, current_user=current_user)
    old_meta = _image_meta(row, style_key)
    if not old_meta:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    styles = {key: dict(value or {}) for key, value in dict(row.cell_styles or {}).items()}
    cell_style = styles.setdefault(style_key, {})
    cell_style.pop("image", None)
    updated = update_row(db, row_id=row.id, current_user=current_user, values={"cell_styles": styles})

    delete_image_file(
        project_id=project.id,
        sheet_id=sheet.id,
        row_id=row.id,
        style_key=style_key,
        image_id=str(old_meta.get("id") or ""),
        mime_type=str(old_meta.get("mimeType") or ""),
    )
    await _broadcast_row(project.id, updated, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
