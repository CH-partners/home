from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_session_token
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import AppUser
from app.schemas.auth import CurrentUserResponse, LoginRequest
from app.services.auth import authenticate_user


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _public_user(user: AppUser) -> CurrentUserResponse:
    return CurrentUserResponse(
        login_id=user.login_id,
        display_name=user.display_name,
        role=user.role,
    )


@router.post("/login", response_model=CurrentUserResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> CurrentUserResponse:
    user = authenticate_user(db, login_id=payload.login_id, password=payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다.",
        )

    settings = get_settings()
    token = create_session_token(user_id=user.id, login_id=user.login_id, role=user.role)
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
        max_age=settings.auth_session_hours * 60 * 60,
        path="/",
    )
    return _public_user(user)


@router.get("/me", response_model=CurrentUserResponse)
def me(user: AppUser = Depends(get_current_user)) -> CurrentUserResponse:
    return _public_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    settings = get_settings()
    response.delete_cookie(
        key=settings.auth_cookie_name,
        path="/",
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
