from __future__ import annotations

from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data"

SOURCES = {
    "housing_rules_vba.csv": "https://raw.githubusercontent.com/CH-partners/housing-db/main/housing_rules_vba.csv",
    "commercial_rules_vba.csv": "https://raw.githubusercontent.com/CH-partners/housing-db/main/commercial_rules_vba.csv",
}

EXPECTED_HEADERS = {
    "housing_rules_vba.csv": "metro,city_gu,dong_ri_eup_myeon,start_date,end_date,limit_deposit,small_amount",
    "commercial_rules_vba.csv": "metro,city_gu,dong_ri_eup_myeon,base_date,year,priority_protected,converted_deposit,top_priority_amount",
}


def _download(url: str) -> bytes:
    request = Request(
        url,
        headers={"User-Agent": "CH-Partners-Home/1.0"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return response.read()
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {url}") from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError(f"다운로드 실패: {url}") from exc


def _validate(filename: str, payload: bytes) -> None:
    if len(payload) < 100:
        raise RuntimeError(f"{filename}: 파일 크기가 비정상적으로 작습니다.")

    text = payload.decode("utf-8-sig", errors="strict")
    first_line = text.splitlines()[0].strip() if text.splitlines() else ""
    if first_line != EXPECTED_HEADERS[filename]:
        raise RuntimeError(f"{filename}: CSV 헤더가 예상 형식과 다릅니다.")


def _atomic_write(target: Path, payload: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp", delete=False) as temp:
        temp.write(payload)
        temp.flush()
        temp_path = Path(temp.name)
    temp_path.replace(target)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for filename, url in SOURCES.items():
        print(f"동기화 중: {filename}")
        payload = _download(url)
        _validate(filename, payload)
        target = DATA_DIR / filename
        _atomic_write(target, payload)
        print(f"완료: {target} ({len(payload):,} bytes)")

    print("소액조회 기준 데이터 동기화 완료")


if __name__ == "__main__":
    main()
