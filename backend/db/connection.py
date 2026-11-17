"""PostgreSQL connection and schema helpers."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlparse

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

_SCHEMA_INITIALIZED = False
_SCHEMA_LOCK = Lock()

SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY,
        original_filename TEXT NOT NULL,
        stored_path TEXT,
        file_sha256 TEXT NOT NULL,
        file_size_bytes BIGINT NOT NULL,
        total_pages INTEGER NOT NULL,
        love_page_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'queued',
        processed_pages INTEGER NOT NULL DEFAULT 0,
        total_love_pages INTEGER NOT NULL DEFAULT 0,
        article_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_documents_status
        ON documents (status)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_documents_created_at
        ON documents (created_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_documents_file_sha256
        ON documents (file_sha256)
    """,
    """
    CREATE TABLE IF NOT EXISTS articles (
        id BIGSERIAL PRIMARY KEY,
        document_id UUID REFERENCES documents (id) ON DELETE CASCADE,
        pdf_path TEXT NOT NULL,
        source_page INTEGER,
        title TEXT NOT NULL DEFAULT '',
        writer TEXT NOT NULL DEFAULT '',
        target TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        needs_review BOOLEAN NOT NULL DEFAULT FALSE,
        review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        content_hash TEXT NOT NULL,
        source_json_path TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # Migration for databases created before upload support was introduced.
    """
    ALTER TABLE articles
        ADD COLUMN IF NOT EXISTS document_id UUID
            REFERENCES documents (id) ON DELETE CASCADE
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_articles_pdf_page_hash
        ON articles (pdf_path, (COALESCE(source_page, -1)), content_hash)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_articles_document_id
        ON articles (document_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_articles_needs_review
        ON articles (needs_review)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_articles_pdf_page
        ON articles (pdf_path, source_page)
    """,
    """
    CREATE TABLE IF NOT EXISTS evaluations (
        id BIGSERIAL PRIMARY KEY,
        article_id BIGINT NOT NULL UNIQUE
            REFERENCES articles (id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        score DOUBLE PRECISION,
        grade TEXT,
        rationale TEXT,
        model TEXT,
        raw_result JSONB,
        error_message TEXT,
        evaluated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_evaluations_status
        ON evaluations (status)
    """,
    """
    CREATE TABLE IF NOT EXISTS article_reviews (
        article_id BIGINT PRIMARY KEY
            REFERENCES articles (id) ON DELETE CASCADE,
        review_status TEXT NOT NULL,
        final_score DOUBLE PRECISION,
        assignee TEXT,
        excluded_with BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS review_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        article_id BIGINT NOT NULL
            REFERENCES articles (id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_review_audit_logs_article
        ON review_audit_logs (article_id)
    """,
    """
    ALTER TABLE article_reviews
        ADD COLUMN IF NOT EXISTS practitioner_index INTEGER NOT NULL DEFAULT 0
    """,
    """
    ALTER TABLE article_reviews DROP CONSTRAINT IF EXISTS article_reviews_pkey
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_article_reviews_article_prac
        ON article_reviews (article_id, practitioner_index)
    """,
    # 재채점으로 실천자 순서가 바뀌어도 검수 결과를 이름으로 다시 연결하기 위해 저장
    """
    ALTER TABLE article_reviews
        ADD COLUMN IF NOT EXISTS practitioner_name TEXT
    """,
    """
    CREATE TABLE IF NOT EXISTS edition_meta (
        edition_id INTEGER PRIMARY KEY,
        label TEXT,
        month TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
]


class DatabaseConfigError(ValueError):
    """Raised when DATABASE_URL is missing or invalid."""


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise DatabaseConfigError(
            "DATABASE_URL이 없습니다. .env.example을 .env로 복사한 뒤 "
            "PostgreSQL 접속 주소를 입력하세요."
        )
    if not url.startswith(("postgres://", "postgresql://")):
        raise DatabaseConfigError(
            "DATABASE_URL은 postgresql:// 또는 postgres://로 시작해야 합니다."
        )
    return url


def database_label(url: str | None = None) -> str:
    """Return a password-redacted database label for logs."""
    raw = url or get_database_url()
    parsed = urlparse(raw)
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    db = (parsed.path or "/").lstrip("/") or "postgres"
    user = parsed.username or ""
    auth = f"{user}@" if user else ""
    return f"postgresql://{auth}{host}:{port}/{db}"


def _apply_schema(conn: psycopg.Connection[Any]) -> None:
    for statement in SCHEMA_STATEMENTS:
        conn.execute(statement)
    conn.commit()


def _ensure_schema(conn: psycopg.Connection[Any]) -> None:
    global _SCHEMA_INITIALIZED
    if _SCHEMA_INITIALIZED:
        return

    with _SCHEMA_LOCK:
        if _SCHEMA_INITIALIZED:
            return
        try:
            _apply_schema(conn)
        except Exception:
            conn.rollback()
            raise
        _SCHEMA_INITIALIZED = True


def get_connection(*, init: bool = True) -> psycopg.Connection[Any]:
    conn = psycopg.connect(
        get_database_url(),
        row_factory=dict_row,
        connect_timeout=5,
    )
    try:
        if init:
            _ensure_schema(conn)
        return conn
    except Exception:
        conn.close()
        raise


@contextmanager
def borrowed_connection(conn: psycopg.Connection[Any] | None) -> Iterator[psycopg.Connection[Any]]:
    """
    호출자가 연결을 넘겨 주면 그대로 쓰고(닫지 않음), 넘기지 않으면 새로 열어 끝날 때 닫는다.
    db 모듈의 함수들이 `conn=None` 인자를 받는 방식을 한 곳에서 처리한다.
    """
    if conn is not None:
        yield conn
        return
    owned = get_connection()
    try:
        yield owned
    finally:
        owned.close()


def init_db(conn: psycopg.Connection[Any] | None = None) -> str:
    """Create missing tables/indexes and return a safe DB label."""
    global _SCHEMA_INITIALIZED
    owns_connection = conn is None
    if owns_connection:
        conn = psycopg.connect(
            get_database_url(),
            row_factory=dict_row,
            connect_timeout=5,
        )
    assert conn is not None

    try:
        with _SCHEMA_LOCK:
            try:
                _apply_schema(conn)
            except Exception:
                conn.rollback()
                raise
            # 호출자가 넘긴 연결(예: 설정 화면의 '연결 확인'으로 시험하는 다른 DB)은
            # 현재 환경 DB와 다를 수 있으므로 전역 초기화 표시를 건드리지 않는다.
            if owns_connection:
                _SCHEMA_INITIALIZED = True
        if owns_connection:
            return database_label()
        # 넘겨받은 연결의 실제 접속 정보로 라벨을 만든다 (비밀번호 제외)
        info = conn.info
        user = f"{info.user}@" if info.user else ""
        return f"postgresql://{user}{info.host}:{info.port}/{info.dbname}"
    finally:
        if owns_connection:
            conn.close()
