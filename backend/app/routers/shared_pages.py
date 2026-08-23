from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_admin, require_worker_or_admin
from app.models.app_settings import AppSettings
from app.models.user import AppUser
from app.schemas.shared_pages import NoticePayload, PageContentPayload, PageContentResponse, SharedPagesResponse


router = APIRouter(prefix="/api/v1/shared-pages", tags=["shared-pages"])
SETTINGS_ID = "main"


def _get_or_create(db: Session) -> AppSettings:
    settings = db.get(AppSettings, SETTINGS_ID)
    if settings is None:
        settings = AppSettings(
            id=SETTINGS_ID,
            menus=[],
            notice={"title": "공지 제목", "date": "", "html": "<li>공지 내용이 없습니다.</li>"},
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


@router.get("", response_model=SharedPagesResponse)
def get_shared_pages(
    db: Session = Depends(get_db),
    _user: AppUser = Depends(require_worker_or_admin),
) -> SharedPagesResponse:
    return _response(_get_or_create(db))


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
