from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.routers.allocation_v2 import router as allocation_v2_router
from app.routers.auth import router as auth_router
from app.routers.group_review_admin_v2 import router as group_review_admin_v2_router
from app.routers.group_review_images import router as group_review_images_router
from app.routers.group_review_v2 import router as group_review_v2_router
from app.routers.health import router as health_router
from app.routers.menu_admin import router as menu_admin_router
from app.routers.rent_trades import router as rent_trades_router
from app.routers.schedule_v2 import router as schedule_v2_router
from app.routers.shared_pages import router as shared_pages_router


app = FastAPI(title="CH PARTNERS Home Backend")

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(group_review_v2_router)
app.include_router(group_review_images_router)
app.include_router(group_review_admin_v2_router)
app.include_router(allocation_v2_router)
app.include_router(shared_pages_router)
app.include_router(menu_admin_router)
app.include_router(schedule_v2_router)
app.include_router(rent_trades_router)

repo_root = Path(__file__).resolve().parents[2]
css_dir = repo_root / "css"
js_dir = repo_root / "js"
vendor_dir = repo_root / "vendor"
data_dir = repo_root / "data"

app.mount("/css", StaticFiles(directory=css_dir), name="css")
app.mount("/js", StaticFiles(directory=js_dir), name="js")
app.mount("/vendor", StaticFiles(directory=vendor_dir), name="vendor")
app.mount("/data", StaticFiles(directory=data_dir), name="data")

_LEGACY_RENT_TRADE_URL = "https://raw.githubusercontent.com/CH-partners/home/main/lease_api.html"


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(repo_root / "index.html")


@app.get("/tools/small-deposit", include_in_schema=False)
def small_deposit_tool() -> FileResponse:
    return FileResponse(repo_root / "주택상가 소액.html")


@app.get("/tools/priority-wage", include_in_schema=False)
def priority_wage_tool() -> FileResponse:
    return FileResponse(repo_root / "최우선임금.html")


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


def _legacy_rent_trade_html() -> str:
    request = Request(
        _LEGACY_RENT_TRADE_URL,
        headers={"User-Agent": "CH-Partners-Home/1.0"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return response.read().decode("utf-8")
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"기존 전월세 조회 파일을 불러오지 못했습니다. HTTP {exc.code}") from exc
    except (URLError, TimeoutError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=502, detail="기존 전월세 조회 파일을 불러오지 못했습니다.") from exc


@app.get("/tools/rent-trades", include_in_schema=False, response_class=HTMLResponse)
def rent_trade_tool() -> HTMLResponse:
    return HTMLResponse(_legacy_rent_trade_html())


@app.get("/lease_api.html", include_in_schema=False, response_class=HTMLResponse)
def legacy_rent_trade_tool() -> HTMLResponse:
    return HTMLResponse(_legacy_rent_trade_html())


@app.get("/{filename}", include_in_schema=False)
def root_html_file(filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename or not filename.lower().endswith(".html"):
        raise HTTPException(status_code=404, detail="Not found")

    target = (repo_root / filename).resolve()
    if target.parent != repo_root or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)
