from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_session_token, decode_session_token
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import AppUser
from app.schemas.auth import CurrentUserResponse, LoginRequest
from app.services.auth import authenticate_user, claim_session, release_session, touch_session


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _public_user(user: AppUser) -> CurrentUserResponse:
    return CurrentUserResponse(
        login_id=user.login_id,
        display_name=user.display_name,
        role=user.role,
    )


def _request_session(request: Request) -> tuple[int, str] | None:
    settings = get_settings()
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        return None
    try:
        payload = decode_session_token(token)
        return int(payload["sub"]), str(payload["sid"])
    except Exception:
        return None


@router.post("/login", response_model=CurrentUserResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> CurrentUserResponse:
    user = authenticate_user(db, login_id=payload.login_id, password=payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다.",
        )

    claimed = claim_session(db, user_id=user.id)
    if claimed is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 다른 기기에서 로그인 중입니다. 기존 기기에서 로그아웃 후 다시 시도해주세요.",
        )
    user, session_id = claimed

    settings = get_settings()
    token = create_session_token(
        user_id=user.id,
        login_id=user.login_id,
        role=user.role,
        session_id=session_id,
    )
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


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
def heartbeat(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> Response:
    session = _request_session(request)
    if session is None or session[0] != user.id or not touch_session(db, user=user, session_id=session[1]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> Response:
    session = _request_session(request)
    if session is not None:
        release_session(db, user_id=session[0], session_id=session[1])

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
