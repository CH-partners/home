from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

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
