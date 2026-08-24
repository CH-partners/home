from __future__ import annotations

import hashlib
import shutil
from pathlib import Path


IMAGE_MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}


def image_storage_root() -> Path:
    return Path(__file__).resolve().parents[3] / "runtime" / "group_review_images"


def _project_folder_name(project_id: str) -> str:
    return hashlib.sha256(project_id.encode("utf-8")).hexdigest()[:32]


def project_image_dir(project_id: str) -> Path:
    return image_storage_root() / _project_folder_name(project_id)


def row_image_dir(project_id: str, sheet_id: int, row_id: int) -> Path:
    return project_image_dir(project_id) / str(int(sheet_id)) / str(int(row_id))


def image_file_path(
    *,
    project_id: str,
    sheet_id: int,
    row_id: int,
    style_key: str,
    image_id: str,
    mime_type: str,
) -> Path:
    extension = IMAGE_MIME_EXTENSIONS.get(mime_type)
    if extension is None:
        raise ValueError("Unsupported image type")
    return row_image_dir(project_id, sheet_id, row_id) / style_key / f"{image_id}{extension}"


def write_image_atomic(
    data: bytes,
    *,
    project_id: str,
    sheet_id: int,
    row_id: int,
    style_key: str,
    image_id: str,
    mime_type: str,
) -> Path:
    target = image_file_path(
        project_id=project_id,
        sheet_id=sheet_id,
        row_id=row_id,
        style_key=style_key,
        image_id=image_id,
        mime_type=mime_type,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.tmp")
    try:
        temporary.write_bytes(data)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def delete_image_file(
    *,
    project_id: str,
    sheet_id: int,
    row_id: int,
    style_key: str,
    image_id: str,
    mime_type: str,
) -> None:
    try:
        target = image_file_path(
            project_id=project_id,
            sheet_id=sheet_id,
            row_id=row_id,
            style_key=style_key,
            image_id=image_id,
            mime_type=mime_type,
        )
    except (TypeError, ValueError):
        return

    try:
        target.unlink(missing_ok=True)
    except OSError:
        return

    root = image_storage_root()
    parent = target.parent
    while parent != root and root in parent.parents:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent


def delete_row_image_tree(project_id: str, sheet_id: int, row_id: int) -> None:
    shutil.rmtree(row_image_dir(project_id, sheet_id, row_id), ignore_errors=True)


def delete_row_image_tree_any_project(sheet_id: int, row_id: int) -> None:
    root = image_storage_root()
    if not root.is_dir():
        return
    for project_dir in root.iterdir():
        if not project_dir.is_dir():
            continue
        shutil.rmtree(project_dir / str(int(sheet_id)) / str(int(row_id)), ignore_errors=True)


def delete_project_image_tree(project_id: str) -> None:
    shutil.rmtree(project_image_dir(project_id), ignore_errors=True)


def detect_image_mime(data: bytes, hinted_type: str | None = None) -> str | None:
    hinted = str(hinted_type or "").split(";", 1)[0].strip().lower()

    detected: str | None = None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        detected = "image/png"
    elif len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        detected = "image/jpeg"
    elif len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        detected = "image/webp"

    if hinted in IMAGE_MIME_EXTENSIONS and hinted == detected:
        return hinted
    return detected
