from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_admin, require_worker_or_admin
from app.models.app_settings import AppSettings
from app.models.user import AppUser
from app.schemas.shared_pages import (
    NoticePayload,
    PageContentPayload,
    PageContentResponse,
    SharedPagesResponse,
    SharedPagesUpdatePayload,
)


router = APIRouter(prefix="/api/v1/shared-pages", tags=["shared-pages"])
SETTINGS_ID = "main"
DEFAULT_NOTICE = {
    "title": "공지 제목",
    "date": "",
    "html": "<li>공지 내용이 없습니다.</li>",
}
GENERAL_BOARD_TITLE = "일반 게시판"
NON_BOARD_PANEL_INDEXES = {0, 10, 11, 12, 13}
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


def _get_or_create(db: Session) -> AppSettings:
    settings = db.get(AppSettings, SETTINGS_ID)
    if settings is None:
        settings = AppSettings(
            id=SETTINGS_ID,
            menus=[],
            notice=dict(DEFAULT_NOTICE),
            page_contents={},
            updated_at=datetime.now(timezone.utc),
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _response(settings: AppSettings) -> SharedPagesResponse:
    return SharedPagesResponse(
        menus=list(settings.menus or []),
        notice=dict(settings.notice or {}),
        page_contents=dict(settings.page_contents or {}),
        updated_at=settings.updated_at,
    )


def _is_uninitialized(settings: AppSettings) -> bool:
    menus_empty = not list(settings.menus or [])
    contents_empty = not dict(settings.page_contents or {})
    notice = dict(settings.notice or {})
    notice_empty = not notice or notice == DEFAULT_NOTICE
    return menus_empty and contents_empty and notice_empty


def _compact_label(value: object) -> str:
    return "".join(str(value or "").split())


def _menu_title_key(value: object) -> str:
    return "".join(
        ch
        for ch in str(value or "").casefold()
        if ch.isalnum() or ch == "&"
    )


def _menu_panel_index(menu: object) -> int | None:
    if not isinstance(menu, dict):
        return None
    try:
        return int(menu.get("panelIndex"))
    except (TypeError, ValueError):
        return None


def _used_panel_indexes(menus: list[object], contents: dict[str, object]) -> set[int]:
    used = set(NON_BOARD_PANEL_INDEXES)
    for menu in menus:
        panel_index = _menu_panel_index(menu)
        if panel_index is not None:
            used.add(panel_index)
    for key in contents:
        if not key.startswith("panel_"):
            continue
        try:
            used.add(int(key.removeprefix("panel_")))
        except ValueError:
            pass
    return used


def _next_dynamic_panel_index(used: set[int]) -> int:
    panel_index = 14
    while panel_index in used:
        panel_index += 1
    return panel_index


def _ensure_general_board(settings: AppSettings) -> bool:
    menus = list(settings.menus or [])
    contents = dict(settings.page_contents or {})

    existing = next(
        (
            menu
            for menu in menus
            if _compact_label(menu.get("title")) == _compact_label(GENERAL_BOARD_TITLE)
        ),
        None,
    )
    if existing is not None:
        panel_index = int(existing.get("panelIndex") or 0)
        key = f"panel_{panel_index}" if panel_index else ""
        if key and key not in contents:
            body_html = "<p>내용을 입력하세요.</p>"
            contents[key] = {
                "majorTitle": GENERAL_BOARD_TITLE,
                "bodyHtml": body_html,
                "tableData": {"enabled": False, "rows": []},
                "html": body_html,
            }
            settings.page_contents = contents
            return True
        return False

    used_indexes: set[int] = {11, 12, 13}
    for menu in menus:
        try:
            used_indexes.add(int(menu.get("panelIndex")))
        except (TypeError, ValueError):
            pass
    for key in contents:
        if key.startswith("panel_"):
            try:
                used_indexes.add(int(key.removeprefix("panel_")))
            except ValueError:
                pass

    panel_index = 14
    while panel_index in used_indexes:
        panel_index += 1

    menus.append(
        {
            "title": GENERAL_BOARD_TITLE,
            "panelIndex": panel_index,
            "location": "top",
            "kind": "panel",
            "group": "",
        }
    )
    body_html = "<p>내용을 입력하세요.</p>"
    contents[f"panel_{panel_index}"] = {
        "majorTitle": GENERAL_BOARD_TITLE,
        "bodyHtml": body_html,
        "tableData": {"enabled": False, "rows": []},
        "html": body_html,
    }
    settings.menus = menus
    settings.page_contents = contents
    return True


@router.get("", response_model=SharedPagesResponse)
def get_shared_pages(
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> SharedPagesResponse:
    settings = _get_or_create(db)

    # A pristine local DB must remain pristine until an ADMIN has had a chance
    # to import the legacy Firebase notice/menu/page contents. Creating the
    # general board here would make the record look initialized and block that
    # one-time bootstrap.
    if not _is_uninitialized(settings) and _ensure_general_board(settings):
        settings.updated_at = datetime.now(timezone.utc)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return _response(settings)


@router.post("/bootstrap", response_model=SharedPagesResponse)
def bootstrap_shared_pages(
    payload: SharedPagesUpdatePayload,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
) -> SharedPagesResponse:
    settings = _get_or_create(db)
    if not _is_uninitialized(settings):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shared pages are already initialized.",
        )

    settings.menus = list(payload.menus)
    settings.notice = dict(payload.notice or DEFAULT_NOTICE)
    settings.page_contents = dict(payload.page_contents)
    _ensure_general_board(settings)
    settings.updated_at = datetime.now(timezone.utc)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return _response(settings)


@router.post("/import-missing", response_model=SharedPagesResponse)
def import_missing_shared_pages(
    payload: SharedPagesUpdatePayload,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
) -> SharedPagesResponse:
    settings = _get_or_create(db)
    menus = list(settings.menus or [])
    contents = dict(settings.page_contents or {})
    source_contents = dict(payload.page_contents or {})

    existing_by_title = {
        _menu_title_key(menu.get("title")): menu
        for menu in menus
        if isinstance(menu, dict) and _menu_title_key(menu.get("title"))
    }
    used_indexes = _used_panel_indexes(menus, contents)
    changed = False

    for source_menu in payload.menus:
        if not isinstance(source_menu, dict):
            continue

        title = str(source_menu.get("title") or "").strip()
        title_key = _menu_title_key(title)
        source_index = _menu_panel_index(source_menu)
        group = str(source_menu.get("group") or "").strip().lower()
        kind = str(source_menu.get("kind") or "panel").strip().lower()

        # Existing local tools stay exactly as they are. This repair endpoint
        # only restores legacy board pages that are absent from the local DB.
        if (
            not title_key
            or source_index is None
            or source_index in NON_BOARD_PANEL_INDEXES
            or kind == "iframe"
            or group == "tool"
        ):
            continue

        source_key = FIXED_CONTENT_KEYS.get(source_index, f"panel_{source_index}")
        source_content = source_contents.get(source_key)
        existing_menu = existing_by_title.get(title_key)
        if existing_menu is not None:
            existing_index = _menu_panel_index(existing_menu)
            if existing_index is not None:
                if existing_index in FIXED_CONTENT_KEYS:
                    target_key = FIXED_CONTENT_KEYS[existing_index]
                else:
                    target_key = f"panel_{existing_index}"
                if (
                    isinstance(source_content, dict)
                    and source_content
                    and target_key not in contents
                ):
                    contents[target_key] = dict(source_content)
                    changed = True
            continue

        target_index = source_index
        if target_index in used_indexes:
            target_index = _next_dynamic_panel_index(used_indexes)

        imported_menu = dict(source_menu)
        imported_menu["panelIndex"] = target_index
        imported_menu["location"] = imported_menu.get("location") or "top"
        imported_menu["kind"] = "panel"
        menus.append(imported_menu)

        existing_by_title[title_key] = imported_menu
        used_indexes.add(target_index)
        changed = True

        if source_index in FIXED_CONTENT_KEYS and target_index == source_index:
            target_key = source_key
        else:
            target_key = f"panel_{target_index}"

        if isinstance(source_content, dict) and source_content and target_key not in contents:
            contents[target_key] = dict(source_content)

    if changed:
        settings.menus = menus
        settings.page_contents = contents
        settings.updated_at = datetime.now(timezone.utc)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return _response(settings)


@router.put("/notice", response_model=SharedPagesResponse)
def update_notice(
    payload: NoticePayload,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
) -> SharedPagesResponse:
    settings = _get_or_create(db)
    settings.notice = payload.model_dump()
    settings.updated_at = datetime.now(timezone.utc)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return _response(settings)


@router.get("/contents/{content_key}", response_model=PageContentResponse)
def get_content(
    content_key: str,
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> PageContentResponse:
    settings = _get_or_create(db)
    contents = dict(settings.page_contents or {})
    return PageContentResponse(key=content_key, content=dict(contents.get(content_key) or {}))


@router.put("/contents/{content_key}", response_model=PageContentResponse)
def update_content(
    content_key: str,
    payload: PageContentPayload,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
) -> PageContentResponse:
    settings = _get_or_create(db)
    contents = dict(settings.page_contents or {})
    contents[content_key] = payload.content
    settings.page_contents = contents
    settings.updated_at = datetime.now(timezone.utc)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return PageContentResponse(key=content_key, content=dict(contents[content_key]))
