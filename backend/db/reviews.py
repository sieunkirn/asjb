"""검수 확정(article_reviews) · 검수 이력(review_audit_logs)과 화면용 기사 조회 SQL."""

from __future__ import annotations

from typing import Any

from services.review_view import as_dict, as_list

# 같은 PDF(호수)를 여러 번 업로드한 경우, 화면에는 "기사가 있는 가장 최근 업로드"만
# 반영한다. (같은 신문을 4번 올리면 기사 수가 4배로 보이는 문제 방지)
LATEST_DOCS_SQL = """
    SELECT DISTINCT ON (d.original_filename) d.id
    FROM documents d
    WHERE EXISTS (SELECT 1 FROM articles a WHERE a.document_id = d.id)
    ORDER BY d.original_filename, d.created_at DESC
"""


ARTICLE_SQL = """
    SELECT
        a.id,
        a.title,
        a.writer,
        a.target,
        a.content,
        a.needs_review AS article_needs_review,
        a.review_reasons AS article_review_reasons,
        a.created_at,
        d.id AS document_id,
        d.original_filename,
        d.created_at AS document_created_at,
        e.status AS eval_status,
        e.score,
        e.rationale,
        e.raw_result,
        e.error_message,
        e.evaluated_at
    FROM articles a
    LEFT JOIN documents d ON d.id = a.document_id
    LEFT JOIN evaluations e ON e.article_id = a.id
"""


def reviews_map(
    conn: Any,
    article_id: int | None = None,
) -> dict[tuple[int, int], dict[str, Any]]:
    """(기사 id, 실천자 순번) → 검수 확정 행. article_id를 주면 그 기사(+연결 기사)만."""
    sql = """
        SELECT article_id, practitioner_index, review_status,
               final_score, assignee, excluded_with, practitioner_name
        FROM article_reviews
    """
    params: list[Any] = []
    if article_id is not None:
        sql += " WHERE article_id = %s OR excluded_with = %s"
        params = [article_id, article_id]
    rows = conn.execute(sql, params).fetchall()
    return {(int(r["article_id"]), int(r["practitioner_index"] or 0)): dict(r) for r in rows}


def log_review_action(
    conn: Any,
    article_id: int,
    action: str,
    detail: str,
    user_name: str,
) -> None:
    conn.execute(
        """
        INSERT INTO review_audit_logs (article_id, action, detail, user_name)
        VALUES (%s, %s, %s, %s)
        """,
        (article_id, action, detail, user_name),
    )


def upsert_review(
    conn: Any,
    article_id: int,
    practitioner_index: int,
    *,
    review_status: str,
    final_score: float | None = None,
    assignee: str | None = None,
    excluded_with: int | None = None,
    practitioner_name: str | None = None,
    only_if_unconfirmed: bool = False,
) -> bool:
    """
    검수 결과 저장. only_if_unconfirmed=True 면 이미 확정된 점수는 덮어쓰지 않는다
    (일괄 확정이 그 사이 사람이 직접 확정한 점수를 덮어쓰는 것 방지).
    실제로 저장했으면 True.
    """
    cur = conn.execute(
        """
        INSERT INTO article_reviews (
            article_id, practitioner_index, review_status,
            final_score, assignee, excluded_with, practitioner_name, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (article_id, practitioner_index) DO UPDATE
        SET review_status = EXCLUDED.review_status,
            final_score = EXCLUDED.final_score,
            assignee = EXCLUDED.assignee,
            excluded_with = EXCLUDED.excluded_with,
            practitioner_name = EXCLUDED.practitioner_name,
            updated_at = NOW()
        WHERE (NOT %s) OR article_reviews.final_score IS NULL
        """,
        (
            article_id,
            practitioner_index,
            review_status,
            final_score,
            assignee,
            excluded_with,
            practitioner_name or None,
            only_if_unconfirmed,
        ),
    )
    return cur.rowcount > 0


def practitioner_count(conn: Any, article_id: int) -> int:
    """채점 결과의 실천자 수 (채점 전·결과 없음이면 0)."""
    row = conn.execute(
        "SELECT raw_result FROM evaluations WHERE article_id = %s", (article_id,)
    ).fetchone()
    raw = as_dict(row and row.get("raw_result"))
    return len([p for p in as_list(raw.get("practitioner_results")) if isinstance(p, dict)])


def practitioner_name(conn: Any, article_id: int, idx: int) -> str:
    if idx <= 0:
        return ""
    row = conn.execute(
        "SELECT raw_result FROM evaluations WHERE article_id = %s", (article_id,)
    ).fetchone()
    raw = as_dict(row and row.get("raw_result"))
    practitioners = as_list(raw.get("practitioner_results"))
    if 0 < idx <= len(practitioners) and isinstance(practitioners[idx - 1], dict):
        return str(practitioners[idx - 1].get("person_name") or "").strip()
    return ""
