from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings


password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def create_session_token(*, user_id: int, login_id: str, role: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "login_id": login_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=settings.auth_session_hours),
    }
    return jwt.encode(payload, settings.auth_secret_key, algorithm="HS256")


def decode_session_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
