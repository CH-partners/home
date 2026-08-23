from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_admin
from app.models.app_settings import AppSettings
from app.models.user import AppUser
from app.schemas.shared_pages import SharedPagesResponse, SharedPagesUpdatePayload


router = APIRouter(prefix="/api/v1/shared-pages", tags=["shared-pages-menu-admin"])
SETTINGS_ID = "main"
FIXED_CONTENT_KEYS = {
    1: "rent",
    2: "wage",
    3: "tax",
    4: "tenantqa",
    5: "guaranteeqa",
    6: "securedqa",
    7: "saleqa",
    8: "browseqa",
    9: "machineqa",
}
ALLOWED_GROUPS = {"", "qna", "work", "search", "reference"}
ALLOWED_KINDS = {"panel", "tool", "iframe"}
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _response(settings: AppSettings) -> SharedPagesResponse:
    return SharedPagesResponse(
        menus=list(settings.menus or []),
        notice=dict(settings.notice or {}),
        page_contents=dict(settings.page_contents or {}),
        updated_at=settings.updated_at,
    )


def _panel_index(menu: object) -> int | None:
    if not isinstance(menu, dict):
        return None
    try:
        return int(menu.get("panelIndex"))
    except (TypeError, ValueError):
        return None


def _title_key(value: object) -> str:
    return "".join(
        ch
        for ch in str(value or "").casefold()
        if ch.isalnum() or ch == "&"
    )


def _next_panel_index(used: set[int]) -> int:
    panel_index = 14
    while panel_index in used:
        panel_index += 1
    return panel_index


def _content_key(panel_index: int) -> str:
    return FIXED_CONTENT_KEYS.get(panel_index, f"panel_{panel_index}")


def _default_content(title: str) -> dict[str, object]:
    body_html = "<p>내용을 입력하세요.</p>"
    return {
        "majorTitle": title,
        "bodyHtml": body_html,
        "tableData": {"enabled": False, "rows": []},
        "html": body_html,
    }


def _clean_color(value: object) -> str:
    color = str(value or "").strip()
    return color.lower() if COLOR_RE.fullmatch(color) else ""


@router.put("/menus", response_model=SharedPagesResponse)
def update_shared_page_menus(
    payload: SharedPagesUpdatePayload,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
) -> SharedPagesResponse:
    settings = db.get(AppSettings, SETTINGS_ID)
    if settings is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shared pages are not initialized.",
        )

    contents = dict(settings.page_contents or {})
    normalized: list[dict[str, object]] = []
    used_indexes: set[int] = set()
    seen_titles: set[str] = set()

    for raw_menu in payload.menus:
        if not isinstance(raw_menu, dict):
            continue

        menu = dict(raw_menu)
        title = str(menu.get("title") or "").strip()
        title_key = _title_key(title)
        hidden = bool(menu.get("hidden"))
        if not title_key:
            continue

        if not hidden and title_key in seen_titles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Duplicate menu title: {title}",
            )
        if not hidden:
            seen_titles.add(title_key)

        panel_index = _panel_index(menu)
        if panel_index is None or panel_index in used_indexes:
            panel_index = _next_panel_index(used_indexes)
        used_indexes.add(panel_index)

        group = str(menu.get("group") or "").strip().lower()
        if group not in ALLOWED_GROUPS:
            group = ""

        kind = str(menu.get("kind") or "panel").strip().lower()
        if kind not in ALLOWED_KINDS:
            kind = "panel"

        menu["title"] = title
        menu["panelIndex"] = panel_index
        menu["location"] = "top"
        menu["kind"] = kind
        menu["group"] = group
        menu["color"] = _clean_color(menu.get("color"))
        menu["groupColor"] = _clean_color(menu.get("groupColor"))
        menu["hidden"] = hidden
        normalized.append(menu)

        # Menu deletion is non-destructive. Existing page contents are retained.
        # Only a new editable board receives a default content record.
        if kind == "panel" and panel_index not in {0, 10, 11, 12, 13} and not hidden:
            key = _content_key(panel_index)
            if key not in contents:
                contents[key] = _default_content(title)

    settings.menus = normalized
    settings.page_contents = contents
    settings.updated_at = datetime.now(timezone.utc)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return _response(settings)
