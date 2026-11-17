"""Runtime settings API: enter OPENAI_API_KEY / DATABASE_URL from the web UI.

- 값은 프로젝트 루트 `.env`에 저장되고 현재 프로세스 환경변수에도 즉시 반영된다.
  (`services.openai_client.get_client`와 `db.connection.get_database_url`은
  호출 시점에 os.environ을 읽으므로 서버를 재시작하지 않아도 된다.)
- 저장된 비밀값은 절대 그대로 돌려주지 않는다. 마스킹한 꼬리 4자리와
  비밀번호를 제거한 DB 라벨만 응답한다.
"""

from __future__ import annotations

import asyncio
import hmac
import os
import re
from pathlib import Path
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import db.connection as db_connection
from db.connection import database_label, init_db
from services.openai_client import DEFAULT_MODEL, DEFAULT_VISION_MODEL

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def require_settings_access(request: Request) -> None:
    """
    API 키 · DB 주소를 바꾸는 설정 API 보호.

    - SETTINGS_ADMIN_TOKEN 이 설정돼 있으면: 요청 헤더 X-Admin-Token 이 같아야 한다.
    - 설정돼 있지 않으면: 이 서버를 실행 중인 PC 자신(127.0.0.1)에서 온 요청만 허용한다.
      (클라우드 배포처럼 외부에서 접속하는 서버에서는 기본적으로 잠긴다.
       프록시 뒤에서 온 요청은 X-Forwarded-For 가 붙으므로 로컬로 보지 않는다.)
    """
    token = os.getenv("SETTINGS_ADMIN_TOKEN", "").strip()
    if token:
        supplied = request.headers.get("x-admin-token", "")
        if hmac.compare_digest(supplied.encode(), token.encode()):
            return
    else:
        host = request.client.host if request.client else ""
        proxied = bool(
            request.headers.get("x-forwarded-for")
            or request.headers.get("forwarded")
            or request.headers.get("x-real-ip")
        )
        if host in _LOOPBACK_HOSTS and not proxied:
            return

    raise HTTPException(
        status_code=403,
        detail={
            "code": "SETTINGS_FORBIDDEN",
            "message": (
                "이 서버에서는 설정 화면으로 API 키 · DB 주소를 바꿀 수 없습니다. "
                "서버를 실행 중인 PC에서 열거나, 서버 환경변수(SETTINGS_ADMIN_TOKEN)를 "
                "설정한 뒤 관리자 토큰을 입력해 주세요."
            ),
        },
    )


router = APIRouter(dependencies=[Depends(require_settings_access)])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
ENV_EXAMPLE_PATH = PROJECT_ROOT / ".env.example"

OPENAI_KEY_ENV = "OPENAI_API_KEY"
DATABASE_URL_ENV = "DATABASE_URL"

_ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")


# ─── 모델 ────────────────────────────────────────────────────────────────────


class SettingsUpdate(BaseModel):
    """빈 문자열은 '값 삭제', None(미전송)은 '변경 없음'."""

    openai_api_key: str | None = Field(default=None, max_length=500)
    database_url: str | None = Field(default=None, max_length=2000)


class SettingsTest(BaseModel):
    """값을 주면 그 값으로, 없으면 현재 저장된 값으로 연결을 확인한다."""

    openai_api_key: str | None = Field(default=None, max_length=500)
    database_url: str | None = Field(default=None, max_length=2000)
    targets: list[str] = Field(default_factory=lambda: ["openai", "database"])


# ─── 유틸 ────────────────────────────────────────────────────────────────────


def _mask_secret(value: str) -> str:
    value = value.strip()
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:3]}…{value[-4:]}"


def _safe_db_label(url: str) -> str | None:
    try:
        return database_label(url)
    except Exception:
        return None


def _validate_openai_key(value: str) -> None:
    if any(ch.isspace() for ch in value):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_OPENAI_API_KEY",
                "message": "OpenAI API 키에 공백이 포함되어 있습니다.",
            },
        )
    if len(value) < 20:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_OPENAI_API_KEY",
                "message": "OpenAI API 키 형식이 올바르지 않습니다. (sk-로 시작하는 전체 키를 입력해 주세요)",
            },
        )


def _validate_database_url(value: str) -> None:
    if not value.startswith(("postgres://", "postgresql://")):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_DATABASE_URL",
                "message": "DATABASE_URL은 postgresql:// 또는 postgres://로 시작해야 합니다.",
            },
        )
    if "USER:PASSWORD@HOST" in value:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_DATABASE_URL",
                "message": "예시 값(USER:PASSWORD@HOST)이 그대로 들어 있습니다. 실제 접속 주소를 입력해 주세요.",
            },
        )
    if any(ch.isspace() for ch in value):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_DATABASE_URL",
                "message": "DATABASE_URL에 공백이 포함되어 있습니다.",
            },
        )


def _write_env_values(values: dict[str, str | None]) -> None:
    """`.env`의 해당 키 줄만 바꾸고 나머지 줄(주석 포함)은 그대로 둔다.

    값이 None이면 `KEY=` 형태로 비운다. 파일이 없으면 .env.example을 복사해 만든다.
    """
    if ENV_PATH.is_file():
        text = ENV_PATH.read_text(encoding="utf-8")
    elif ENV_EXAMPLE_PATH.is_file():
        text = ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
    else:
        text = ""

    lines = text.splitlines()
    remaining = dict(values)
    out: list[str] = []
    for line in lines:
        match = _ENV_LINE_RE.match(line)
        key = match.group(1) if match else None
        if key in remaining:
            new_value = remaining.pop(key)
            out.append(f"{key}={new_value or ''}")
        else:
            out.append(line)

    for key, new_value in remaining.items():
        out.append(f"{key}={new_value or ''}")

    tmp_path = ENV_PATH.with_suffix(".env.tmp")
    tmp_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    tmp_path.replace(ENV_PATH)


def _apply_env(key: str, value: str | None) -> None:
    if value:
        os.environ[key] = value
    else:
        os.environ.pop(key, None)


def _current_status() -> dict[str, Any]:
    api_key = (os.getenv(OPENAI_KEY_ENV) or "").strip()
    db_url = (os.getenv(DATABASE_URL_ENV) or "").strip()
    db_placeholder = "USER:PASSWORD@HOST" in db_url
    return {
        "openai": {
            "configured": bool(api_key),
            "masked": _mask_secret(api_key) if api_key else None,
            "model": DEFAULT_MODEL,
            "vision_model": DEFAULT_VISION_MODEL,
        },
        "database": {
            "configured": bool(db_url) and not db_placeholder,
            "label": _safe_db_label(db_url) if db_url and not db_placeholder else None,
        },
        "env_file_exists": ENV_PATH.is_file(),
    }


def _test_openai(api_key: str) -> dict[str, Any]:
    from openai import AuthenticationError, OpenAI

    if not api_key:
        return {"ok": False, "message": "OpenAI API 키가 설정되어 있지 않습니다."}
    try:
        client = OpenAI(api_key=api_key, timeout=20.0, max_retries=0)
        client.models.retrieve(DEFAULT_MODEL)
        return {"ok": True, "message": f"OpenAI 연결 성공 (모델 {DEFAULT_MODEL} 사용 가능)"}
    except AuthenticationError:
        return {
            "ok": False,
            "message": "OpenAI API 키 인증에 실패했습니다. 키를 다시 확인해 주세요.",
        }
    except Exception as exc:  # noqa: BLE001 - 사용자에게 원인 문자열을 그대로 보여준다
        return {"ok": False, "message": f"OpenAI 연결 실패: {type(exc).__name__}: {str(exc)[:300]}"}


def _test_database(db_url: str) -> dict[str, Any]:
    if not db_url:
        return {"ok": False, "message": "DATABASE_URL이 설정되어 있지 않습니다."}
    try:
        with psycopg.connect(db_url, connect_timeout=5, row_factory=psycopg.rows.dict_row) as conn:
            conn.execute("SELECT 1")
            # 테이블이 없으면 만들어 둔다 (업로드 시 첫 연결에서 하던 일을 미리 수행)
            init_db(conn)
        return {
            "ok": True,
            "message": f"DB 연결 성공 ({database_label(db_url)}) · 테이블 준비 완료",
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": f"DB 연결 실패: {type(exc).__name__}: {str(exc)[:300]}"}


# ─── 라우트 ──────────────────────────────────────────────────────────────────


@router.get("/settings")
async def get_settings_status() -> dict[str, Any]:
    """현재 설정 상태(마스킹)를 반환한다."""
    return _current_status()


@router.put("/settings")
async def update_settings(payload: SettingsUpdate) -> dict[str, Any]:
    """API 키 · DB 주소를 .env와 현재 프로세스에 저장한다."""
    if payload.openai_api_key is None and payload.database_url is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "NOTHING_TO_SAVE", "message": "저장할 값이 없습니다."},
        )

    to_write: dict[str, str | None] = {}
    saved: list[str] = []

    if payload.openai_api_key is not None:
        api_key = payload.openai_api_key.strip()
        if api_key:
            _validate_openai_key(api_key)
        to_write[OPENAI_KEY_ENV] = api_key or None
        saved.append("openai_api_key")

    if payload.database_url is not None:
        db_url = payload.database_url.strip()
        if db_url:
            _validate_database_url(db_url)
        to_write[DATABASE_URL_ENV] = db_url or None
        saved.append("database_url")

    try:
        await asyncio.to_thread(_write_env_values, to_write)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "ENV_WRITE_ERROR",
                "message": f".env 파일을 저장하지 못했습니다: {type(exc).__name__}: {str(exc)[:200]}",
            },
        ) from exc

    for key, value in to_write.items():
        _apply_env(key, value)

    if DATABASE_URL_ENV in to_write:
        # 다른 DB로 바뀌었을 수 있으므로 다음 연결에서 스키마를 다시 확인한다.
        db_connection._SCHEMA_INITIALIZED = False  # noqa: SLF001

    return {**_current_status(), "saved": saved}


@router.post("/settings/test")
async def test_settings(payload: SettingsTest) -> dict[str, Any]:
    """OpenAI 키 · DB 연결을 실제로 시험한다. 값을 주면 저장하지 않고 그 값으로 시험한다."""
    targets = {t.strip().lower() for t in payload.targets}
    result: dict[str, Any] = {"openai": None, "database": None}

    if "openai" in targets:
        api_key = (payload.openai_api_key or os.getenv(OPENAI_KEY_ENV) or "").strip()
        result["openai"] = await asyncio.to_thread(_test_openai, api_key)

    if "database" in targets:
        db_url = (payload.database_url or os.getenv(DATABASE_URL_ENV) or "").strip()
        result["database"] = await asyncio.to_thread(_test_database, db_url)

    return result
