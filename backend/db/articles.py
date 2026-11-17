"""Article CRUD and upsert helpers (PostgreSQL)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from db.common import as_optional_uuid, utcnow
from db.connection import borrowed_connection


def content_hash(
    *,
    title: str,
    writer: str,
    target: str,
    content: str,
    source_page: int | None,
) -> str:
    payload = "\n".join(
        [
            str(source_page if source_page is not None else ""),
            title.strip(),
            writer.strip(),
            target.strip(),
            content.strip(),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_review_reasons(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
        return [value]
    return [str(value)]


def _row_to_dict(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None

    out = dict(row)
    for key in ("review_reasons", "raw_result"):
        value = out.get(key)
        if isinstance(value, str):
            try:
                out[key] = json.loads(value)
            except json.JSONDecodeError:
                pass

    for key, value in list(out.items()):
        if isinstance(value, UUID):
            out[key] = str(value)
        elif hasattr(value, "isoformat"):
            out[key] = value.isoformat()

    return out


def upsert_article(
    conn: psycopg.Connection[Any],
    article: dict[str, Any],
    *,
    pdf_path: str,
    document_id: str | UUID | None = None,
    source_json_path: str | None = None,
) -> tuple[int, bool]:
    """Insert or update one article and return ``(article_id, inserted)``."""
    now = utcnow()
    doc_uuid = as_optional_uuid(document_id)
    title = str(article.get("title") or "").strip()
    writer = str(article.get("writer") or "").strip()
    target = str(article.get("target") or "").strip()
    content = str(article.get("content") or "").strip()
    source_page = article.get("source_page")
    source_page_int = int(source_page) if source_page is not None else None
    needs_review = bool(article.get("needs_review"))
    review_reasons = _normalize_review_reasons(article.get("review_reasons"))
    digest = content_hash(
        title=title,
        writer=writer,
        target=target,
        content=content,
        source_page=source_page_int,
    )

    existing = conn.execute(
        """
        SELECT id
        FROM articles
        WHERE pdf_path = %s
          AND source_page IS NOT DISTINCT FROM %s
          AND content_hash = %s
        """,
        (pdf_path, source_page_int, digest),
    ).fetchone()

    if existing:
        article_id = int(existing["id"])
        conn.execute(
            """
            UPDATE articles
            SET document_id = COALESCE(%s, document_id),
                title = %s,
                writer = %s,
                target = %s,
                content = %s,
                needs_review = %s,
                review_reasons = %s,
                source_json_path = COALESCE(%s, source_json_path),
                updated_at = %s
            WHERE id = %s
            """,
            (
                doc_uuid,
                title,
                writer,
                target,
                content,
                needs_review,
                Jsonb(review_reasons),
                source_json_path,
                now,
                article_id,
            ),
        )
        return article_id, False

    row = conn.execute(
        """
        INSERT INTO articles (
            document_id, pdf_path, source_page, title, writer, target, content,
            needs_review, review_reasons, content_hash, source_json_path,
            created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            doc_uuid,
            pdf_path,
            source_page_int,
            title,
            writer,
            target,
            content,
            needs_review,
            Jsonb(review_reasons),
            digest,
            source_json_path,
            now,
            now,
        ),
    ).fetchone()
    assert row is not None
    return int(row["id"]), True


def ensure_pending_evaluation(
    conn: psycopg.Connection[Any],
    article_id: int,
) -> None:
    """Create a pending evaluation row if the article has none yet."""
    now = utcnow()
    conn.execute(
        """
        INSERT INTO evaluations (article_id, status, created_at, updated_at)
        VALUES (%s, 'pending', %s, %s)
        ON CONFLICT (article_id) DO NOTHING
        """,
        (article_id, now, now),
    )


def upsert_articles_from_payload(
    payload: dict[str, Any],
    *,
    source_json_path: str | Path | None = None,
    conn: psycopg.Connection[Any] | None = None,
) -> dict[str, int]:
    """Upsert all articles from a CLI/API extraction payload."""

    pdf_path = str(payload.get("pdf") or "").strip()
    if not pdf_path:
        raise ValueError("payload missing required 'pdf' field")

    document_id = as_optional_uuid(payload.get("document_id"))
    articles = payload.get("articles") or []
    if not isinstance(articles, list):
        raise ValueError("payload 'articles' must be a list")

    json_path = str(source_json_path) if source_json_path else None
    inserted = 0
    updated = 0

    with borrowed_connection(conn) as conn:
        try:
            for raw in articles:
                if not isinstance(raw, dict):
                    continue
                article_id, was_inserted = upsert_article(
                    conn,
                    raw,
                    pdf_path=pdf_path,
                    document_id=document_id,
                    source_json_path=json_path,
                )
                if was_inserted:
                    inserted += 1
                else:
                    updated += 1
                ensure_pending_evaluation(conn, article_id)
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {
        "inserted": inserted,
        "updated": updated,
        "total": inserted + updated,
    }


def get_article(
    article_id: int,
    *,
    conn: psycopg.Connection[Any] | None = None,
) -> dict[str, Any] | None:
    with borrowed_connection(conn) as conn:
        row = conn.execute(
            "SELECT * FROM articles WHERE id = %s",
            (article_id,),
        ).fetchone()
        return _row_to_dict(row)


def list_articles(
    *,
    document_id: str | UUID | None = None,
    pdf_path: str | None = None,
    needs_review: bool | None = None,
    limit: int | None = None,
    conn: psycopg.Connection[Any] | None = None,
) -> list[dict[str, Any]]:
    """List articles, optionally filtered by upload document and review flag."""
    if limit is not None and (limit < 1 or limit > 10_000):
        raise ValueError("limit must be between 1 and 10000")

    clauses: list[str] = []
    params: list[Any] = []

    if document_id is not None:
        clauses.append("document_id = %s")
        params.append(as_optional_uuid(document_id))
    if pdf_path is not None:
        clauses.append("pdf_path = %s")
        params.append(pdf_path)
    if needs_review is not None:
        clauses.append("needs_review = %s")
        params.append(needs_review)

    sql = "SELECT * FROM articles"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY source_page, id"
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)

    with borrowed_connection(conn) as conn:
        rows = conn.execute(sql, params).fetchall()
        return [result for row in rows if (result := _row_to_dict(row)) is not None]
