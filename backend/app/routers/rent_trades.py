from __future__ import annotations

from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from app.core.config import get_settings
from app.dependencies.auth import require_worker_or_admin
from app.models.user import AppUser


router = APIRouter(prefix="/api/v1/rent-trades", tags=["rent-trades"])

_ENDPOINTS = {
    "apt": "RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
    "rh": "RTMSDataSvcRHRent/getRTMSDataSvcRHRent",
    "sh": "RTMSDataSvcSHRent/getRTMSDataSvcSHRent",
    "offi": "RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
}
_BASE_URL = "https://apis.data.go.kr/1613000"


@router.get("/query", response_class=Response)
def query_rent_trades(
    property_type: str = Query(pattern="^(apt|rh|sh|offi)$"),
    lawd_cd: str = Query(pattern="^[0-9]{5}$"),
    deal_ymd: str = Query(pattern="^[0-9]{6}$"),
    _user: AppUser = Depends(require_worker_or_admin),
) -> Response:
    settings = get_settings()
    service_key = settings.rent_api_service_key.strip()
    if not service_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="전월세 실거래가 API 서비스 키가 서버에 설정되지 않았습니다.",
        )

    endpoint = _ENDPOINTS[property_type]
    encoded_key = quote(service_key, safe="%")
    url = (
        f"{_BASE_URL}/{endpoint}"
        f"?serviceKey={encoded_key}"
        f"&LAWD_CD={lawd_cd}"
        f"&DEAL_YMD={deal_ymd}"
        "&numOfRows=100&pageNo=1"
    )

    request = Request(
        url,
        headers={
            "Accept": "application/xml,text/xml,*/*",
            "User-Agent": "CH-Partners-Home/1.0",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=20) as upstream:
            body = upstream.read()
            content_type = upstream.headers.get_content_type() or "application/xml"
    except HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"국토부 API 응답 오류: HTTP {exc.code}",
        ) from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="국토부 API에 연결할 수 없습니다.",
        ) from exc

    return Response(content=body, media_type=content_type)
