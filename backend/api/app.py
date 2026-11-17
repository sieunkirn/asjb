"""FastAPI entry point for the SSD love-article backend."""

from __future__ import annotations

import hmac
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import (
    CORSMiddleware,
)
from fastapi.responses import (
    FileResponse,
    JSONResponse,
)
from fastapi.staticfiles import (
    StaticFiles,
)

from api.routes.documents import (
    router as documents_router,
)
from api.routes.evaluations import (
    router as evaluations_router,
)
from api.routes.settings import (
    router as settings_router,
)
from api.routes.webapp import (
    router as webapp_router,
)
from config import get_settings

PROJECT_ROOT = Path(__file__).resolve().parent.parent


settings = get_settings()


app = FastAPI(
    title="성심당 사랑평가 API",
    description=(
        "PDF 업로드 → 사랑기사 페이지 탐색 → GPT 기사 추출 → 실천자 점수화 및 기업 검토 표시"
    ),
    version="1.1.0",
)


# ── 간단 접속 토큰 (선택) ──
# .env에 API_ACCESS_TOKEN을 설정하면 /api/* 요청에 X-Access-Token 헤더가 필요하다.
# (연결 확인용 /api/v1/health 는 제외. 비워 두면 기존처럼 인증 없이 동작)
API_ACCESS_TOKEN = os.getenv("API_ACCESS_TOKEN", "").strip()


# 로그인 없이 부를 수 있는 경로: 서버 상태, '로그인이 필요한가?' 확인
_AUTH_EXEMPT_PATHS = {"/api/v1/health", "/api/v1/auth/status"}

# 접속 코드 무차별 대입 방지: 같은 접속지(IP)에서 틀린 코드를 5분 안에 10번 보내면 잠시 차단
_AUTH_WINDOW_SEC = 300
_AUTH_MAX_FAILS = 10
_auth_failures: dict[str, deque] = defaultdict(deque)


def _client_ip(request) -> str:
    # 프록시(Render 등) 뒤에서는 프록시가 덧붙인 마지막 값이 실제 접속지다.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip() or "?"
    return request.client.host if request.client else "?"


def _auth_locked(ip: str) -> bool:
    now = time.monotonic()
    fails = _auth_failures[ip]
    while fails and now - fails[0] > _AUTH_WINDOW_SEC:
        fails.popleft()
    return len(fails) >= _AUTH_MAX_FAILS


@app.middleware("http")
async def _access_token_guard(request, call_next):
    if (
        API_ACCESS_TOKEN
        # 브라우저의 CORS 사전 요청(OPTIONS)에는 토큰이 붙지 않으므로 통과시킨다
        and request.method != "OPTIONS"
        and request.url.path.startswith("/api")
        and request.url.path not in _AUTH_EXEMPT_PATHS
    ):
        supplied = request.headers.get("x-access-token", "")
        ip = _client_ip(request)
        if _auth_locked(ip):
            return JSONResponse(
                status_code=429,
                content={
                    "detail": {
                        "code": "TOO_MANY_ATTEMPTS",
                        "message": "접속 코드를 여러 번 잘못 입력했습니다. 잠시(약 5분) 뒤에 다시 시도해 주세요.",
                    }
                },
            )
        # 상수 시간 비교: 응답 시간 차이로 코드를 추측하는 것을 막는다
        if not hmac.compare_digest(supplied.encode(), API_ACCESS_TOKEN.encode()):
            if supplied:  # 코드를 입력했는데 틀린 경우만 실패로 센다 (처음 방문은 제외)
                _auth_failures[ip].append(time.monotonic())
            return JSONResponse(
                status_code=401,
                content={
                    "detail": {
                        "code": "UNAUTHORIZED",
                        "message": "접속 코드가 필요하거나 올바르지 않습니다. 관리자에게 문의해 주세요.",
                    }
                },
            )
    return await call_next(request)


# CORS 는 토큰 검사보다 바깥(마지막에 등록)에 둔다 → 401 응답에도 CORS 헤더가 붙어
# 다른 주소(예: Vite 5173)에서 띄운 화면이 오류 내용을 읽을 수 있다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=[
        "*",
    ],
    allow_headers=[
        "*",
    ],
    expose_headers=[
        "Content-Disposition",
    ],
)


app.include_router(
    documents_router,
    prefix="/api/v1/documents",
    tags=[
        "documents",
    ],
)


app.include_router(
    evaluations_router,
    prefix="/api/v1",
    tags=[
        "evaluations",
    ],
)


# 웹 화면에서 OPENAI_API_KEY · DATABASE_URL 입력 (api/routes/settings.py)
app.include_router(
    settings_router,
    prefix="/api/v1",
    tags=[
        "settings",
    ],
)


# 프론트 화면(대시보드·검수·리포트) 호환 API — Mock 대신 DB에서 제공
app.include_router(
    webapp_router,
    prefix="/api",
    tags=[
        "webapp",
    ],
)


@app.get("/api/v1/auth/status")
def auth_status() -> dict[str, bool]:
    """로그인(접속 코드)이 필요한 서버인지 알려준다. 비밀 값은 포함하지 않는다."""
    return {"required": bool(API_ACCESS_TOKEN)}


@app.get("/api/v1/auth/check")
def auth_check() -> dict[str, bool]:
    """접속 코드가 맞는지 확인. 잘못됐으면 위 보호 로직에서 401로 끝나 여기까지 오지 않는다."""
    return {"ok": True}


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ssd-scoring-api",
    }


# 프론트 빌드 폴더를 지정하면 이 서버 하나로 화면까지 서빙한다.
# .env: FRONTEND_DIST=C:/Users/.../BREDRED_simplified/dist  (npm run build 결과)
# 미설정이거나 경로가 없으면(다른 컴퓨터에서 복사한 .env 등) 저장소 구조의
# ../dist 를 자동으로 찾는다 — 담당자 컴퓨터에서는 설정이 필요 없다.
_dist_env = os.getenv("FRONTEND_DIST", "").strip()
_dist_candidates = [
    *([Path(_dist_env)] if _dist_env else []),
    # 저장소 구조: BREDRED_simplified/backend/api/app.py → ../../dist
    Path(__file__).resolve().parents[2] / "dist",
    # 운영 폴더 구조: 사랑기사시스템/SSD_Scoring/api/app.py → 옆의 BREDRED_frontend/dist
    Path(__file__).resolve().parents[2] / "BREDRED_frontend" / "dist",
]
FRONTEND_DIST = next(
    (p for p in _dist_candidates if (p / "index.html").is_file()),
    None,
)
FRONTEND_READY = FRONTEND_DIST is not None

if FRONTEND_READY and (FRONTEND_DIST / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="assets",
    )


@app.get(
    "/",
    include_in_schema=False,
)
def frontend_or_demo() -> FileResponse:
    """
    프론트 빌드가 있으면 실제 화면을, 없으면 업로드 테스트 화면을 반환한다.
    """

    if FRONTEND_READY:
        return FileResponse(FRONTEND_DIST / "index.html")

    return FileResponse(PROJECT_ROOT / "api" / "demo.html")


@app.get(
    "/{spa_path:path}",
    include_in_schema=False,
)
def frontend_static(spa_path: str) -> FileResponse:
    """
    프론트 빌드의 기타 정적 파일(favicon 등)을 서빙한다.
    /api 경로는 위에서 먼저 매칭되므로 여기로 오지 않는다.
    """

    # 알 수 없는 /api 경로는 화면(index.html) 대신 404
    if spa_path == "api" or spa_path.startswith("api/"):
        raise HTTPException(status_code=404)

    if FRONTEND_READY:
        # 경로 조작(../, 절대경로) 차단: dist 폴더 안의 파일만 내려준다.
        # (막지 않으면 /../backend/.env 로 API 키·DB 비밀번호가 유출됨)
        dist_root = FRONTEND_DIST.resolve()
        try:
            candidate = (dist_root / spa_path).resolve()
        except (OSError, ValueError):
            candidate = None
        if candidate is not None and candidate.is_relative_to(dist_root) and candidate.is_file():
            return FileResponse(candidate)
        # 해시 라우팅 SPA — 나머지는 index.html
        return FileResponse(FRONTEND_DIST / "index.html")

    raise HTTPException(status_code=404)
