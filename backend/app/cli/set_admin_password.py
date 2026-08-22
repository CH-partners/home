from __future__ import annotations

import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import get_session_factory
from app.models.user import AppUser

ADMIN_LOGIN_ID = "admin"


def main() -> None:
    password = getpass.getpass("admin 새 비밀번호: ")
    if not password:
        raise SystemExit("비밀번호는 비워둘 수 없습니다.")

    confirm = getpass.getpass("admin 새 비밀번호 확인: ")
    if password != confirm:
        raise SystemExit("비밀번호 확인이 일치하지 않습니다.")

    password_hash = hash_password(password)
    session_factory = get_session_factory()

    with session_factory() as db:
        user = db.scalar(
            select(AppUser).where(
                AppUser.login_id == ADMIN_LOGIN_ID,
                AppUser.role == "ADMIN",
            )
        )
        if user is None:
            raise SystemExit("admin 관리자 계정을 찾을 수 없습니다.")

        user.password_hash = password_hash
        user.active = True
        db.commit()

    print("admin password updated")


if __name__ == "__main__":
    main()
