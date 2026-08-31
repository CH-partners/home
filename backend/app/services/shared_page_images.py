from __future__ import annotations

import hashlib
import re
from pathlib import Path


IMAGE_MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
EXTENSION_MIME_TYPES = {extension: mime for mime, extension in IMAGE_MIME_EXTENSIONS.items()}
IMAGE_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")


def image_storage_root() -> Path:
    return Path(__file__).resolve().parents[3] / "runtime" / "shared_page_images"


def _content_folder_name(content_key: str) -> str:
    return hashlib.sha256(content_key.encode("utf-8")).hexdigest()[:32]


def content_image_dir(content_key: str) -> Path:
    return image_storage_root() / _content_folder_name(content_key)


def image_file_path(*, content_key: str, image_id: str, mime_type: str) -> Path:
    if not IMAGE_ID_PATTERN.fullmatch(str(image_id or "")):
        raise ValueError("Invalid image id")
    extension = IMAGE_MIME_EXTENSIONS.get(mime_type)
    if extension is None:
        raise ValueError("Unsupported image type")
    return content_image_dir(content_key) / f"{image_id}{extension}"


def write_image_atomic(
    data: bytes,
    *,
    content_key: str,
    image_id: str,
    mime_type: str,
) -> Path:
    target = image_file_path(
        content_key=content_key,
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


def find_image_file(content_key: str, image_id: str) -> tuple[Path, str] | None:
    if not IMAGE_ID_PATTERN.fullmatch(str(image_id or "")):
        return None
    directory = content_image_dir(content_key)
    for extension, mime_type in EXTENSION_MIME_TYPES.items():
        candidate = directory / f"{image_id}{extension}"
        if candidate.is_file():
            return candidate, mime_type
    return None


def delete_image_file(content_key: str, image_id: str) -> None:
    found = find_image_file(content_key, image_id)
    if found is None:
        return
    path, _ = found
    try:
        path.unlink(missing_ok=True)
    except OSError:
        return
    try:
        path.parent.rmdir()
    except OSError:
        pass


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
