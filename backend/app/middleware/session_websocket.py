from __future__ import annotations

from http.cookies import SimpleCookie

from app.core.config import get_settings
from app.core.security import decode_session_token
from app.db.session import get_session_factory
from app.models.user import AppUser
from app.services.auth import session_is_active


class ActiveSessionWebSocketMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "websocket" or not str(scope.get("path") or "").startswith(
            "/api/v1/group-review/ws/"
        ):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        raw_cookie = headers.get(b"cookie", b"").decode("latin-1")
        cookies = SimpleCookie()
        if raw_cookie:
            cookies.load(raw_cookie)

        settings = get_settings()
        morsel = cookies.get(settings.auth_cookie_name)
        token = morsel.value if morsel is not None else None
        if not token:
            await send({"type": "websocket.close", "code": 4401})
            return

        try:
            payload = decode_session_token(token)
            user_id = int(payload["sub"])
            session_id = str(payload["sid"])
        except Exception:
            await send({"type": "websocket.close", "code": 4401})
            return

        session_factory = get_session_factory()
        with session_factory() as db:
            user = db.get(AppUser, user_id)
            allowed = bool(
                user
                and user.active
                and session_is_active(user, session_id=session_id)
            )

        if not allowed:
            await send({"type": "websocket.close", "code": 4401})
            return

        await self.app(scope, receive, send)
