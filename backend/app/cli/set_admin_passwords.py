from __future__ import annotations

import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import get_session_factory
from app.models.user import AppUser

ADMIN_LOGIN_IDS = ("admin1", "admin2")


def main() -> None:
    password = getpass.getpass("ADMIN 공통 비밀번호: ")
    if not password:
        raise SystemExit("비밀번호는 비워둘 수 없습니다.")

    password_hash = hash_password(password)
    session_factory = get_session_factory()

    with session_factory() as db:
        users = list(
            db.scalars(
                select(AppUser).where(
                    AppUser.login_id.in_(ADMIN_LOGIN_IDS),
                    AppUser.role == "ADMIN",
                )
            ).all()
        )
        found = {user.login_id for user in users}
        missing = [login_id for login_id in ADMIN_LOGIN_IDS if login_id not in found]
        if missing:
            raise SystemExit(f"관리자 계정을 찾을 수 없습니다: {', '.join(missing)}")

        for user in users:
            user.password_hash = password_hash
            user.active = True
        db.commit()

    print("admin1/admin2 password updated")


if __name__ == "__main__":
    main()
