from __future__ import annotations

import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import get_session_factory
from app.models.user import AppUser

NEW_ADMINS = [
    ("admin", "관리자"),
    ("admin4", "관리자4"),
]


def main() -> None:
    password = getpass.getpass("admin/admin4 공통 비밀번호: ")
    if not password:
        raise SystemExit("비밀번호는 비워둘 수 없습니다.")

    confirm = getpass.getpass("비밀번호 확인: ")
    if password != confirm:
        raise SystemExit("비밀번호 확인이 일치하지 않습니다.")

    password_hash = hash_password(password)
    session_factory = get_session_factory()
    created = 0
    skipped = 0

    with session_factory() as db:
        for login_id, display_name in NEW_ADMINS:
            existing = db.scalar(select(AppUser).where(AppUser.login_id == login_id))
            if existing is not None:
                skipped += 1
                continue

            db.add(
                AppUser(
                    login_id=login_id,
                    display_name=display_name,
                    password_hash=password_hash,
                    role="ADMIN",
                    active=True,
                )
            )
            created += 1

        db.commit()

    print(f"admin accounts created={created} skipped={skipped}")


if __name__ == "__main__":
    main()
