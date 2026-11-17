"""CRUD helpers for uploaded documents and extraction jobs."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from db.common import as_uuid, utcnow
from db.connection import borrowed_connection

VALID_STATUSES = {
    "queued",
    "processing",
    "completed",
    "completed_with_errors",
    "failed",
}
FINAL_STATUSES = {"completed", "completed_with_errors", "failed"}


def _row_to_dict(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None

    out = dict(row)
    for key, value in list(out.items()):
        if isinstance(value, UUID):
            out[key] = str(value)
        elif hasattr(value, "isoformat"):
            out[key] = value.isoformat()

    love_pages = out.get("love_page_numbers")
    if isinstance(love_pages, str):
        try:
            out["love_page_numbers"] = json.loads(love_pages)
        except json.JSONDecodeError:
            out["love_page_numbers"] = []

    return out


def create_document(
    *,
    document_id: str | UUID,
    original_filename: str,
    stored_path: str,
    file_sha256: str,
    file_size_bytes: int,
    total_pages: int,
    love_page_numbers: list[int],
    conn: psycopg.Connection[Any] | None = None,
) -> dict[str, Any]:
    """Insert an uploaded document in queued state."""

    now = utcnow()
    doc_uuid = as_uuid(document_id)

    with borrowed_connection(conn) as conn:
        try:
            row = conn.execute(
                """
                INSERT INTO documents (
                    id, original_filename, stored_path, file_sha256,
                    file_size_bytes, total_pages, love_page_numbers,
                    status, processed_pages, total_love_pages, article_count,
                    created_at, updated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s,
                    'queued', 0, %s, 0, %s, %s
                )
                RETURNING *
                """,
                (
                    doc_uuid,
                    original_filename,
                    stored_path,
                    file_sha256,
                    file_size_bytes,
                    total_pages,
                    Jsonb(love_page_numbers),
                    len(love_page_numbers),
                    now,
                    now,
                ),
            ).fetchone()
            conn.commit()
            result = _row_to_dict(row)
            assert result is not None
            return result
        except Exception:
            conn.rollback()
            raise


def update_document_status(
    document_id: str | UUID,
    *,
    status: str,
    error_message: str | None = None,
    article_count: int | None = None,
    processed_pages: int | None = None,
    conn: psycopg.Connection[Any] | None = None,
) -> None:
    """Change extraction state and manage started/completed timestamps."""
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid document status: {status}")

    now = utcnow()
    with borrowed_connection(conn) as conn:
        try:
            conn.execute(
                """
                UPDATE documents
                SET status = %s,
                    error_message = %s,
                    article_count = COALESCE(%s, article_count),
                    processed_pages = COALESCE(%s, processed_pages),
                    started_at = CASE
                        WHEN %s = 'processing' THEN COALESCE(started_at, %s)
                        ELSE started_at
                    END,
                    completed_at = CASE
                        WHEN %s IN ('completed', 'completed_with_errors', 'failed')
                        THEN %s
                        ELSE completed_at
                    END,
                    updated_at = %s
                WHERE id = %s
                """,
                (
                    status,
                    error_message,
                    article_count,
                    processed_pages,
                    status,
                    now,
                    status,
                    now,
                    now,
                    as_uuid(document_id),
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def update_document_progress(
    document_id: str | UUID,
    *,
    processed_pages: int,
    article_count: int,
    conn: psycopg.Connection[Any] | None = None,
) -> None:
    """Persist page-by-page extraction progress."""
    with borrowed_connection(conn) as conn:
        try:
            conn.execute(
                """
                UPDATE documents
                SET processed_pages = %s,
                    article_count = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (
                    processed_pages,
                    article_count,
                    utcnow(),
                    as_uuid(document_id),
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def get_document(
    document_id: str | UUID,
    *,
    conn: psycopg.Connection[Any] | None = None,
) -> dict[str, Any] | None:
    with borrowed_connection(conn) as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = %s",
            (as_uuid(document_id),),
        ).fetchone()
        return _row_to_dict(row)


def list_documents(
    *,
    limit: int = 50,
    conn: psycopg.Connection[Any] | None = None,
) -> list[dict[str, Any]]:
    """Return newest upload/extraction jobs first."""
    if limit < 1 or limit > 200:
        raise ValueError("limit must be between 1 and 200")

    with borrowed_connection(conn) as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM documents
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
        return [result for row in rows if (result := _row_to_dict(row)) is not None]
