from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers.auth import router as auth_router
from app.routers.group_review_v2 import router as group_review_v2_router
from app.routers.health import router as health_router


app = FastAPI(title="CH PARTNERS Home Backend")

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(group_review_v2_router)

repo_root = Path(__file__).resolve().parents[2]
css_dir = repo_root / "css"
js_dir = repo_root / "js"

app.mount("/css", StaticFiles(directory=css_dir), name="css")
app.mount("/js", StaticFiles(directory=js_dir), name="js")


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(repo_root / "index.html")


@app.get("/{filename}", include_in_schema=False)
def root_html_file(filename: str) -> FileResponse:
    # Only root-level HTML tools are exposed. Backend files and secrets are never served.
    if "/" in filename or "\\" in filename or not filename.lower().endswith(".html"):
        raise HTTPException(status_code=404, detail="Not found")

    target = (repo_root / filename).resolve()
    if target.parent != repo_root or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)
