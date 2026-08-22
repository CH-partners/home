from __future__ import annotations

import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import get_session_factory
from app.models.user import AppUser


WORKERS = [
    "남기범",
    "김학년",
    "이중근",
    "이동훈",
    "임기철",
    "우창균",
    "정동춘",
    "김현경",
    "김소라",
    "손성민",
    "심아영",
    "이학모",
]

ADMINS = [
    ("admin", "관리자"),
    ("admin1", "관리자1"),
    ("admin2", "관리자2"),
    ("admin4", "관리자4"),
]


def _prompt_secret(label: str) -> str:
    value = getpass.getpass(f"{label}: ")
    if not value:
        raise SystemExit("비밀번호는 비워둘 수 없습니다.")
    return value


def main() -> None:
    worker_password = _prompt_secret("WORKER 초기 비밀번호")
    admin_password = _prompt_secret("ADMIN 초기 비밀번호")

    worker_hash = hash_password(worker_password)
    admin_hash = hash_password(admin_password)

    session_factory = get_session_factory()
    created = 0
    skipped = 0

    with session_factory() as db:
        for name in WORKERS:
            exists = db.scalar(select(AppUser.id).where(AppUser.login_id == name))
            if exists is not None:
                skipped += 1
                continue
            db.add(
                AppUser(
                    login_id=name,
                    display_name=name,
                    password_hash=worker_hash,
                    role="WORKER",
                    active=True,
                )
            )
            created += 1

        for login_id, display_name in ADMINS:
            exists = db.scalar(select(AppUser.id).where(AppUser.login_id == login_id))
            if exists is not None:
                skipped += 1
                continue
            db.add(
                AppUser(
                    login_id=login_id,
                    display_name=display_name,
                    password_hash=admin_hash,
                    role="ADMIN",
                    active=True,
                )
            )
            created += 1

        db.commit()

    print(f"created={created} skipped={skipped}")


if __name__ == "__main__":
    main()
