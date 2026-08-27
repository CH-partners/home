from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_session_token
from app.db.session import get_db
from app.models.user import AppUser
from app.services.auth import session_is_active


def get_current_user(request: Request, db: Session = Depends(get_db)) -> AppUser:
    settings = get_settings()
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = decode_session_token(token)
        user_id = int(payload["sub"])
        session_id = str(payload["sid"])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated") from exc

    user = db.get(AppUser, user_id)
    if user is None or not user.active or not session_is_active(user, session_id=session_id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def require_admin(user: AppUser = Depends(get_current_user)) -> AppUser:
    if user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


def require_worker_or_admin(user: AppUser = Depends(get_current_user)) -> AppUser:
    if user.role not in {"ADMIN", "WORKER"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return user
