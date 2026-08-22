from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import get_session_factory


router = APIRouter()


@router.get("/health")
def read_health() -> dict[str, str]:
    database_status = "error"

    try:
        session_factory = get_session_factory()
        with session_factory() as db:
            db.execute(text("SELECT 1"))
        database_status = "ok"
    except Exception:
        database_status = "error"

    return {
        "status": "ok",
        "database": database_status,
    }
