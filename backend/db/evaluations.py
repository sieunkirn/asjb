"""Evaluation (scoring) CRUD helpers (PostgreSQL)."""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from db.articles import _row_to_dict
from db.common import as_uuid, utcnow
from db.connection import borrowed_connection

STALE_PROCESSING_MINUTES = max(1, int(os.getenv("EVALUATION_STALE_MINUTES", "20")))


def stale_processing_cutoff() -> datetime:
    return utcnow() - timedelta(minutes=STALE_PROCESSING_MINUTES)


def claim_evaluation_processing(
    article_id: int,
    *,
    model: str | None = None,
    force: bool = False,
    conn: psycopg.Connection[Any] | None = None,
) -> int | None:
    """
    평가 시작 권한을 DB에서 원자적으로 얻는다. 얻으면 evaluation id, 못 얻으면 None.

    - 이미 다른 작업이 진행 중(processing, 아직 멈춘 것으로 보기 전)이면 못 얻는다
      -> 같은 기사를 두 번 채점(GPT 비용 2배)하는 것을 막는다.
    - force가 아니면 이미 완료(done)된 기사도 못 얻는다.
    - 멈춘 processing(서버 재시작 등)은 force 여부와 상관없이 다시 가져간다.
    """

    now = utcnow()
    with borrowed_connection(conn) as conn:
        try:
            row = conn.execute(
                """
                INSERT INTO evaluations (
                    article_id, status, model, error_message, created_at, updated_at
                )
                VALUES (%s, 'processing', %s, NULL, %s, %s)
                ON CONFLICT (article_id) DO UPDATE
                SET status = 'processing',
                    model = EXCLUDED.model,
                    error_message = NULL,
                    updated_at = EXCLUDED.updated_at
                WHERE (
                        evaluations.status <> 'processing'
                        OR evaluations.updated_at < %s
                      )
                  AND (%s OR evaluations.status <> 'done')
                RETURNING id
                """,
                (article_id, model, now, now, stale_processing_cutoff(), force),
            ).fetchone()
            conn.commit()
            return int(row["id"]) if row else None
        except Exception:
            conn.rollback()
            raise


def list_pending_articles(
    *,
    limit: int | None = None,
    conn: psycopg.Connection[Any] | None = None,
) -> list[dict[str, Any]]:
    """Articles that still need scoring (pending / missing evaluation)."""

    sql = """
        SELECT a.*, e.status AS evaluation_status, e.id AS evaluation_id
        FROM articles a
        LEFT JOIN evaluations e ON e.article_id = a.id
        WHERE e.id IS NULL OR e.status = 'pending'
        ORDER BY a.id
    """
    params: list[Any] = []
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)

    with borrowed_connection(conn) as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_dict(dict(r)) for r in rows]  # type: ignore[misc]


def upsert_evaluation(
    article_id: int,
    *,
    status: str,
    score: float | None = None,
    grade: str | None = None,
    rationale: str | None = None,
    model: str | None = None,
    raw_result: dict[str, Any] | list[Any] | str | None = None,
    error_message: str | None = None,
    conn: psycopg.Connection[Any] | None = None,
) -> int:
    """Insert or update the single evaluation row for an article."""

    now = utcnow()
    if isinstance(raw_result, (dict, list)):
        raw_value: Any = Jsonb(raw_result)
    elif isinstance(raw_result, str):
        raw_value = Jsonb({"text": raw_result})
    else:
        raw_value = None

    evaluated_at = now if status in {"done", "error"} else None

    with borrowed_connection(conn) as conn:
        existing = conn.execute(
            "SELECT id FROM evaluations WHERE article_id = %s",
            (article_id,),
        ).fetchone()

        if existing:
            eval_id = int(existing["id"])
            conn.execute(
                """
                UPDATE evaluations
                SET status = %s, score = %s, grade = %s, rationale = %s,
                    model = %s, raw_result = %s, error_message = %s,
                    evaluated_at = COALESCE(%s, evaluated_at),
                    updated_at = %s
                WHERE id = %s
                """,
                (
                    status,
                    score,
                    grade,
                    rationale,
                    model,
                    raw_value,
                    error_message,
                    evaluated_at,
                    now,
                    eval_id,
                ),
            )
        else:
            row = conn.execute(
                """
                INSERT INTO evaluations (
                    article_id, status, score, grade, rationale, model,
                    raw_result, error_message, evaluated_at, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    article_id,
                    status,
                    score,
                    grade,
                    rationale,
                    model,
                    raw_value,
                    error_message,
                    evaluated_at,
                    now,
                    now,
                ),
            ).fetchone()
            assert row is not None
            eval_id = int(row["id"])

        conn.commit()
        return eval_id


def get_evaluation(
    article_id: int,
    *,
    conn: psycopg.Connection[Any] | None = None,
) -> dict[str, Any] | None:
    with borrowed_connection(conn) as conn:
        row = conn.execute(
            "SELECT * FROM evaluations WHERE article_id = %s",
            (article_id,),
        ).fetchone()
        return _row_to_dict(row)


def mark_evaluation_processing(
    article_id: int,
    *,
    model: str | None = None,
    conn: psycopg.Connection[Any] | None = None,
) -> int:
    """
    평가를 processing 상태로 변경한다.
    """

    now = utcnow()

    with borrowed_connection(conn) as conn:
        try:
            row = conn.execute(
                """
                INSERT INTO evaluations (
                    article_id,
                    status,
                    model,
                    error_message,
                    created_at,
                    updated_at
                )
                VALUES (
                    %s,
                    'processing',
                    %s,
                    NULL,
                    %s,
                    %s
                )
                ON CONFLICT (article_id)
                DO UPDATE
                SET status = 'processing',
                    model = EXCLUDED.model,
                    error_message = NULL,
                    updated_at = EXCLUDED.updated_at
                RETURNING id
                """,
                (
                    article_id,
                    model,
                    now,
                    now,
                ),
            ).fetchone()

            assert row is not None

            conn.commit()

            return int(row["id"])

        except Exception:
            conn.rollback()
            raise


def save_evaluation_result(
    article_id: int,
    *,
    score: float,
    rationale: str,
    model: str,
    raw_result: dict[str, Any],
    conn: psycopg.Connection[Any] | None = None,
) -> int:
    """
    검증이 끝난 점수 결과를 저장한다.
    """

    return upsert_evaluation(
        article_id,
        status="done",
        score=score,
        grade=None,
        rationale=rationale,
        model=model,
        raw_result=raw_result,
        error_message=None,
        conn=conn,
    )


def save_evaluation_error(
    article_id: int,
    *,
    model: str | None,
    error_message: str,
    conn: psycopg.Connection[Any] | None = None,
) -> int:
    """
    점수화 중 발생한 기술 오류를 저장한다.

    기술 오류는 기업 검토 필요 유형으로 저장하지 않는다.
    """

    now = utcnow()

    with borrowed_connection(conn) as conn:
        try:
            row = conn.execute(
                """
                INSERT INTO evaluations (
                    article_id,
                    status,
                    model,
                    error_message,
                    evaluated_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    %s,
                    'error',
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                )
                ON CONFLICT (article_id)
                DO UPDATE
                -- 재채점이 일시 오류로 실패해도 이전의 정상 결과(raw_result)는 지우지 않는다.
                -- 이전 결과가 있으면 done 상태로 되돌리고, 오류는 error_message에만 남긴다.
                SET status = CASE
                        WHEN evaluations.raw_result IS NOT NULL THEN 'done'
                        ELSE 'error'
                    END,
                    model = EXCLUDED.model,
                    error_message =
                        EXCLUDED.error_message,
                    evaluated_at = CASE
                        WHEN evaluations.raw_result IS NOT NULL
                            THEN COALESCE(evaluations.evaluated_at, EXCLUDED.evaluated_at)
                        ELSE EXCLUDED.evaluated_at
                    END,
                    updated_at =
                        EXCLUDED.updated_at
                RETURNING id
                """,
                (
                    article_id,
                    model,
                    error_message,
                    now,
                    now,
                    now,
                ),
            ).fetchone()

            assert row is not None

            conn.commit()

            return int(row["id"])

        except Exception:
            conn.rollback()
            raise


def list_document_evaluations(
    document_id: Any,
    *,
    needs_review: bool | None = None,
    conn: psycopg.Connection[Any] | None = None,
) -> list[dict[str, Any]]:
    """
    하나의 업로드 문서에 속한 모든 평가 결과를 조회한다.
    """

    params: list[Any] = [as_uuid(document_id)]

    review_clause = ""

    if needs_review is not None:
        review_clause = """
            AND COALESCE(
                (
                    e.raw_result
                    ->>
                    'evaluation_needs_review'
                )::BOOLEAN,
                FALSE
            ) = %s
        """

        params.append(needs_review)

    with borrowed_connection(conn) as conn:
        rows = conn.execute(
            f"""
            SELECT
                a.id
                    AS article_id,

                a.document_id,
                a.source_page,
                a.title,
                a.writer,
                a.target,

                a.needs_review
                    AS article_needs_review,

                a.review_reasons
                    AS article_review_reasons,

                e.id
                    AS evaluation_id,

                COALESCE(
                    e.status,
                    'pending'
                ) AS status,

                e.score,
                e.grade,
                e.rationale,
                e.model,
                e.raw_result,
                e.error_message,
                e.evaluated_at,
                e.created_at,
                e.updated_at

            FROM articles a

            LEFT JOIN evaluations e
                ON e.article_id = a.id

            WHERE a.document_id = %s

            {review_clause}

            ORDER BY
                a.source_page,
                a.id
            """,
            params,
        ).fetchall()

        results: list[dict[str, Any]] = []

        for row in rows:
            item = _row_to_dict(dict(row))

            if item is None:
                continue

            raw_result = item.get("raw_result")

            if not isinstance(
                raw_result,
                dict,
            ):
                raw_result = {}

            item["evaluation_needs_review"] = bool(
                raw_result.get(
                    "evaluation_needs_review",
                    False,
                )
            )

            item["evaluation_review_reasons"] = list(
                raw_result.get("evaluation_review_reasons") or []
            )

            item["quality_warnings"] = list(raw_result.get("quality_warnings") or [])

            item["practitioner_results"] = list(raw_result.get("practitioner_results") or [])

            results.append(item)

        return results


def list_recent_corrections(
    limit: int = 8,
    *,
    scan: int = 80,
    conn: psycopg.Connection[Any] | None = None,
) -> list[dict[str, Any]]:
    """
    검수자가 AI 판단을 고친 최근 사례. 점수 기록 방식:
      - AI 점수: 자동 확정(auto_score_applied)이면 score, 아니면 후보 점수(candidate_score_if_confirmed)
      - 사람 점수: article_reviews.final_score
    둘이 다른 경우만 모아, 사람 판단을 AI가 닮아 가도록 다음 채점의 참고 사례로 쓴다.
    개인정보 보호를 위해 이름 · 부서는 내보내지 않고(요약은 호출한 쪽에서 이름을 지움) 유형 · 점수 · 실천 요약만 돌려준다.
    """
    with borrowed_connection(conn) as conn:
        rows = conn.execute(
            """
            SELECT r.article_id, r.practitioner_index, r.practitioner_name,
                   r.final_score, a.writer, a.target, e.raw_result
            FROM article_reviews r
            JOIN articles a ON a.id = r.article_id
            JOIN evaluations e ON e.article_id = r.article_id
            WHERE r.review_status = 'approved'
              AND r.final_score IS NOT NULL
              AND e.raw_result IS NOT NULL
              AND r.assignee IS DISTINCT FROM 'AI 자동 확정'
            ORDER BY r.updated_at DESC
            LIMIT %s
            """,
            (scan,),
        ).fetchall()

    corrections: list[dict[str, Any]] = []
    for row in rows:
        raw = row.get("raw_result")
        results = [
            p for p in ((raw or {}).get("practitioner_results") or []) if isinstance(p, dict)
        ]
        idx = int(row["practitioner_index"] or 0)
        if not results:
            continue
        if idx == 0:
            person = results[0] if len(results) == 1 else None
        else:
            person = results[idx - 1] if 0 < idx <= len(results) else None
        if person is None:
            continue
        ai = (
            person.get("score")
            if person.get("auto_score_applied")
            else person.get("candidate_score_if_confirmed")
        )
        if ai is None:
            continue
        human = float(row["final_score"])
        if abs(float(ai) - human) < 1e-9:
            continue
        names = [
            person.get("person_name"),
            row.get("practitioner_name"),
            row.get("writer"),
            row.get("target"),
        ]
        corrections.append(
            {
                "ai_type": person.get("score_type"),
                "ai_score": float(ai),
                "human_score": human,
                "summary": person.get("basis_item_or_action") or person.get("evidence") or "",
                "names": [n for n in names if n],
            }
        )
        if len(corrections) >= limit:
            break
    return corrections


def get_document_evaluation_summary(
    document_id: Any,
    *,
    conn: psycopg.Connection[Any] | None = None,
) -> dict[str, Any]:
    """
    문서별 점수화 진행률을 조회한다.
    """

    with borrowed_connection(conn) as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*)::INTEGER
                    AS total,

                COUNT(*) FILTER (
                    WHERE e.id IS NULL
                       OR e.status = 'pending'
                )::INTEGER
                    AS pending,

                COUNT(*) FILTER (
                    WHERE e.status = 'processing'
                      AND e.updated_at >= %s
                )::INTEGER
                    AS processing,

                COUNT(*) FILTER (
                    WHERE e.status = 'done'
                )::INTEGER
                    AS done,

                COUNT(*) FILTER (
                    WHERE e.status = 'error'
                       OR (
                            e.status = 'processing'
                            AND e.updated_at < %s
                          )
                )::INTEGER
                    AS error,

                COUNT(*) FILTER (
                    WHERE e.status = 'done'
                      AND COALESCE(
                          (
                              e.raw_result
                              ->>
                              'evaluation_needs_review'
                          )::BOOLEAN,
                          FALSE
                      ) = TRUE
                )::INTEGER
                    AS needs_review

            FROM articles a

            LEFT JOIN evaluations e
                ON e.article_id = a.id

            WHERE a.document_id = %s
            """,
            (
                stale_processing_cutoff(),
                stale_processing_cutoff(),
                as_uuid(document_id),
            ),
        ).fetchone()

        values = dict(row or {})

    total = int(values.get("total") or 0)

    pending = int(values.get("pending") or 0)

    processing = int(values.get("processing") or 0)

    done = int(values.get("done") or 0)

    error = int(values.get("error") or 0)

    needs_review_count = int(values.get("needs_review") or 0)

    finished = done + error

    if total == 0:
        status = "not_ready"

    elif processing > 0 or (finished > 0 and pending > 0):
        status = "processing"

    elif pending == total:
        status = "pending"

    elif finished == total and error > 0:
        status = "completed_with_errors"

    elif done == total:
        status = "completed"

    else:
        status = "pending"

    return {
        "document_id": str(document_id),
        "status": status,
        "total": total,
        "pending": pending,
        "processing": processing,
        "done": done,
        "error": error,
        "needs_review": needs_review_count,
        "progress_percent": (
            round(
                finished / total * 100,
                1,
            )
            if total
            else 0.0
        ),
    }


def list_article_reviews(
    article_ids: list[int],
    *,
    conn: psycopg.Connection[Any] | None = None,
) -> dict[tuple[int, int], dict[str, Any]]:
    """사람이 검수·확정한 결과: (기사 id, 실천자 순번) → 검수 행."""
    if not article_ids:
        return {}

    with borrowed_connection(conn) as conn:
        rows = conn.execute(
            """
            SELECT article_id, practitioner_index, review_status,
                   final_score, practitioner_name
            FROM article_reviews
            WHERE article_id = ANY(%s)
            """,
            (list(article_ids),),
        ).fetchall()
        return {(int(r["article_id"]), int(r["practitioner_index"] or 0)): dict(r) for r in rows}
