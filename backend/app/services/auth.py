from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.models.user import AppUser


def authenticate_user(db: Session, *, login_id: str, password: str) -> AppUser | None:
    normalized_login_id = login_id.strip()
    user = db.scalar(select(AppUser).where(AppUser.login_id == normalized_login_id))
    if user is None or not user.active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def _session_cutoff() -> datetime:
    settings = get_settings()
    return datetime.now(timezone.utc) - timedelta(minutes=settings.auth_session_stale_minutes)


def session_is_active(user: AppUser, *, session_id: str | None = None) -> bool:
    if not user.active_session_id or not user.session_last_seen_at:
        return False
    if user.session_last_seen_at <= _session_cutoff():
        return False
    if session_id is not None and user.active_session_id != session_id:
        return False
    return True


def claim_session(db: Session, *, user_id: int) -> tuple[AppUser, str] | None:
    user = db.scalar(select(AppUser).where(AppUser.id == user_id).with_for_update())
    if user is None or not user.active:
        return None
    if session_is_active(user):
        return None

    session_id = uuid4().hex
    user.active_session_id = session_id
    user.session_last_seen_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user, session_id


def touch_session(db: Session, *, user: AppUser, session_id: str) -> bool:
    if not session_is_active(user, session_id=session_id):
        return False
    user.session_last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return True


def release_session(db: Session, *, user_id: int, session_id: str) -> None:
    user = db.scalar(select(AppUser).where(AppUser.id == user_id).with_for_update())
    if user is None or user.active_session_id != session_id:
        return
    user.active_session_id = None
    user.session_last_seen_at = None
    db.commit()
