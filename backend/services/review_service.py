"""검수 화면용 조회 · 일괄 확정 · 호수 요약 (DB 조회 + 변환을 묶는다)."""

from __future__ import annotations

from typing import Any

from db.connection import get_connection
from db.reviews import (
    ARTICLE_SQL,
    LATEST_DOCS_SQL,
    log_review_action,
    reviews_map,
    upsert_review,
)
from services.review_view import (
    article_rows,
    attach_related,
    parse_public_id,
    summarize_editions,
)

REVIEWER_NAME = "웹 검수자"


def reviewer_or_default(value: str | None) -> str:
    return (value or "").strip() or REVIEWER_NAME


def fetch_articles(edition: int | None = None) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            ARTICLE_SQL + f" WHERE a.document_id IN ({LATEST_DOCS_SQL})" + " ORDER BY a.id"
        ).fetchall()
        reviews = reviews_map(conn)

    rows_out: list[dict[str, Any]] = []
    for row in rows:
        rows_out.extend(article_rows(dict(row), reviews))
    attach_related(rows_out, reviews)

    if edition is not None:
        rows_out = [a for a in rows_out if a["edition"] == edition]
    return rows_out


def fetch_rows_for_article(article_id: int) -> list[dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute(ARTICLE_SQL + " WHERE a.id = %s", (article_id,)).fetchone()
        if row is None:
            return []
        # 전체 검수 테이블 대신 이 기사 관련 검수만 조회 (확정 속도 개선)
        reviews = reviews_map(conn, article_id)
    rows_out = article_rows(dict(row), reviews)
    attach_related(rows_out, reviews)
    return rows_out


def find_row(public_id: str) -> dict[str, Any] | None:
    aid, _idx = parse_public_id(public_id)
    for r in fetch_rows_for_article(aid):
        if r["id"] == public_id:
            return r
    return None


AUTO_REVIEWER = "AI 자동 확정"


def confirm_approved_rows(edition: int, reviewer: str, *, label: str = "일괄 확정") -> int:
    """
    승인(AI가 자동 확정한 유형) 상태인데 최종 점수가 아직 없는 행을 AI 점수 그대로 확정한다.
    화면의 '일괄 확정' 버튼과 채점 후 자동 확정(AUTO_CONFIRM_AFTER_SCORING)이 함께 쓴다.
    확정한 행 수를 돌려준다.
    """
    rows = fetch_articles(edition)
    # 추출 확인 필요(본문 인식 불량 등) 경고가 붙은 행은 자동 확정하지 않고 사람이 보게 둔다
    targets = [
        r
        for r in rows
        if r["status"] == "승인"
        and r.get("finalScore") is None
        and "추출 확인 필요" not in str(r.get("flagReason") or "")
    ]
    with get_connection() as conn:
        confirmed = 0
        for r in targets:
            aid, idx = parse_public_id(r["id"])
            # 그 사이 사람이 직접 확정한 점수는 덮어쓰지 않는다
            saved = upsert_review(
                conn,
                aid,
                idx if idx is not None else 0,
                review_status="approved",
                final_score=float(r["aiScore"]),
                assignee=reviewer,
                practitioner_name=r["subject"] if idx is not None else None,
                only_if_unconfirmed=True,
            )
            if not saved:
                continue
            confirmed += 1
            detail = f"{label} — AI 점수 {r['aiScore']:g}점"
            if "-" in r["id"]:
                detail += f" — 실천자 {r['subject']}"
            log_review_action(conn, aid, "confirm", detail, user_name=reviewer)
        conn.commit()
    return confirmed


# ─── 호수 · 통계 ─────────────────────────────────────────────────────────────
def list_editions() -> list[dict[str, Any]]:
    """호수 목록 — 발행월은 호수 관리에서 저장한 값(edition_meta)이 업로드 시각보다 우선."""
    articles = fetch_articles()
    with get_connection() as conn:
        docs = conn.execute(
            f"SELECT original_filename, created_at FROM documents WHERE id IN ({LATEST_DOCS_SQL}) ORDER BY created_at"
        ).fetchall()
        meta_rows = conn.execute("SELECT edition_id, label, month FROM edition_meta").fetchall()
    meta = {int(m["edition_id"]): dict(m) for m in meta_rows}
    return summarize_editions(articles, docs, meta)
