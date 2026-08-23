from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.routers.allocation_v2 import router as allocation_v2_router
from app.routers.auth import router as auth_router
from app.routers.group_review_admin_v2 import router as group_review_admin_v2_router
from app.routers.group_review_v2 import router as group_review_v2_router
from app.routers.health import router as health_router
from app.routers.schedule_v2 import router as schedule_v2_router
from app.routers.shared_pages import router as shared_pages_router


app = FastAPI(title="CH PARTNERS Home Backend")

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(group_review_v2_router)
app.include_router(group_review_admin_v2_router)
app.include_router(allocation_v2_router)
app.include_router(shared_pages_router)
app.include_router(schedule_v2_router)

repo_root = Path(__file__).resolve().parents[2]
css_dir = repo_root / "css"
js_dir = repo_root / "js"
vendor_dir = repo_root / "vendor"

app.mount("/css", StaticFiles(directory=css_dir), name="css")
app.mount("/js", StaticFiles(directory=js_dir), name="js")
app.mount("/vendor", StaticFiles(directory=vendor_dir), name="vendor")


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(repo_root / "index.html")


@app.get("/tools/mortgage-extract", include_in_schema=False, response_class=HTMLResponse)
def mortgage_extract_tool() -> HTMLResponse:
    source = (repo_root / "근저당추출.html").read_text(encoding="utf-8")
    source = source.replace(
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
        "/vendor/pdf.min.js",
    )
    source = source.replace(
        "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
        "/vendor/exceljs.min.js",
    )
    source = source.replace(
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
        "/vendor/pdf.worker.min.js",
    )
    source = source.replace(
        "이 페이지는 로컬 파일에서 직접 열어 사용하는 도구입니다. 최초 로드 시 pdf.js / ExcelJS 라이브러리를 인터넷에서 불러오므로 인터넷 연결이 필요합니다.<br>",
        "이 도구는 사내 로컬 서버에서 동작하며 pdf.js / ExcelJS도 서버의 고정 버전을 사용하므로 인터넷 연결이 필요하지 않습니다.<br>",
    )
    return HTMLResponse(source)


@app.get("/{filename}", include_in_schema=False)
def root_html_file(filename: str) -> FileResponse:
    # Only root-level HTML tools are exposed. Backend files and secrets are never served.
    if "/" in filename or "\\" in filename or not filename.lower().endswith(".html"):
        raise HTTPException(status_code=404, detail="Not found")

    target = (repo_root / filename).resolve()
    if target.parent != repo_root or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)
