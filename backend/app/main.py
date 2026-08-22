from fastapi import FastAPI

from app.routers.auth import router as auth_router
from app.routers.health import router as health_router


app = FastAPI(title="CH PARTNERS Home Backend")

app.include_router(health_router)
app.include_router(auth_router)
