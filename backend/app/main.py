from fastapi import FastAPI

from app.routers.auth import router as auth_router
from app.routers.group_review_v2 import router as group_review_v2_router
from app.routers.health import router as health_router


app = FastAPI(title="CH PARTNERS Home Backend")

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(group_review_v2_router)
