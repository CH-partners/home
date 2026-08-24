import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.routers.allocation_v2 import router as allocation_v2_router
from app.routers.auth import router as auth_router
from app.routers.group_review_admin_v2 import router as group_review_admin_v2_router
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


def _rent_trade_tool_html() -> str:
    source = (repo_root / "lease_api.html").read_text(encoding="utf-8")

    source = source.replace(
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
        "/vendor/bootstrap.min.css",
    )
    source = source.replace(
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
        "/vendor/bootstrap.bundle.min.js",
    )
    source = re.sub(
        r'const\s+SERVICE_KEY\s*=\s*["\'][^"\']*["\'];',
        'const SERVICE_KEY = "";',
        source,
        count=1,
    )
    source = re.sub(
        r'const\s+BJD_URL\s*=\s*["\'][^"\']*["\'];',
        'const BJD_URL = "/data/bjd_code.json";',
        source,
        count=1,
    )

    legacy_url_block = """const url =
                `https://apis.data.go.kr/1613000/${endpoints[type]}` +
                `?serviceKey=${SERVICE_KEY}` +
                `&LAWD_CD=${bjd.lawd_cd}` +
                `&DEAL_YMD=${ym}` +
                `&numOfRows=100` +
                `&pageNo=1`;"""
    local_url_block = """const url =
                `/api/v1/rent-trades/query` +
                `?property_type=${encodeURIComponent(type)}` +
                `&lawd_cd=${encodeURIComponent(bjd.lawd_cd)}` +
                `&deal_ymd=${encodeURIComponent(ym)}`;"""
    source = source.replace(legacy_url_block, local_url_block)

    legacy_fetch_block = """            const res = await fetch(url);
            const text = await res.text();

            console.log(ym, text);"""
    local_fetch_block = """            const res = await fetch(url, { credentials: \"include\" });
            const text = await res.text();

            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try {
                    const payload = JSON.parse(text);
                    if (payload?.detail) detail = payload.detail;
                } catch (_) {}
                throw new Error(detail);
            }

            console.log(ym, text);"""
    source = source.replace(legacy_fetch_block, local_fetch_block)

    source = source.replace(
        'alert("API 호출 실패: " + err.message + "\\n브라우저 CORS 문제일 수 있습니다.");',
        'document.getElementById("matchInfo").innerHTML = `<span class="text-danger fw-bold">API 조회 실패: ${err.message}</span>`;\n        alert("API 호출 실패: " + err.message);',
    )
    return source


@app.get("/tools/rent-trades", include_in_schema=False, response_class=HTMLResponse)
def rent_trade_tool() -> HTMLResponse:
    return HTMLResponse(_rent_trade_tool_html())


@app.get("/lease_api.html", include_in_schema=False, response_class=HTMLResponse)
def legacy_rent_trade_tool() -> HTMLResponse:
    return HTMLResponse(_rent_trade_tool_html())


@app.get("/{filename}", include_in_schema=False)
def root_html_file(filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename or not filename.lower().endswith(".html"):
        raise HTTPException(status_code=404, detail="Not found")

    target = (repo_root / filename).resolve()
    if target.parent != repo_root or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)
