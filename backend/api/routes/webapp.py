"""프론트 화면(대시보드 · 기사 검수 · 리포트 · 호수) 호환 API.

Mock 데이터 대신 PostgreSQL(documents/articles/evaluations)을 프론트의
`Article`/`Edition`/`DashboardStats` 계약으로 변환해 제공하고,
검수 확정 결과를 `article_reviews`/`review_audit_logs` 테이블에 저장한다.
→ 같은 DATABASE_URL을 쓰면 어느 컴퓨터에서든 같은 데이터가 보인다.

실천자가 여러 명인 기사는 실천자별로 점수·검토 여부가 다르므로
화면에는 **실천자 한 명당 한 행**으로 나눠 내려준다.
행 id는 실천자가 1명이면 "1810", 여러 명이면 "1810-1", "1810-2" 형식이며,
검수 확정도 (기사 id, 실천자 순번) 단위로 저장된다.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from config import get_settings
from db.connection import get_connection
from db.reviews import (
    ARTICLE_SQL,
    log_review_action,
    practitioner_count,
    practitioner_name,
    upsert_review,
)
from services.review_service import (
    confirm_approved_rows,
    fetch_articles,
    find_row,
    list_editions,
    reviewer_or_default,
)
from services.review_view import (
    InvalidArticleId,
    build_review_content,
    compute_stats,
    edition_from_filename,
)
from services.review_view import parse_public_id as _parse_public_id

router = APIRouter()


def parse_public_id(value: str) -> tuple[int, int | None]:
    """화면용 id → (기사 id, 실천자 순번). 형식이 틀리면 404."""
    try:
        return _parse_public_id(value)
    except InvalidArticleId:
        raise _article_not_found() from None


# 최종 확정 가능한 점수 (README 점수 기준과 동일)
ALLOWED_FINAL_SCORES = (0.0, 1.0, 2.0, 4.0, 5.0)


class ConfirmPayload(BaseModel):
    finalScore: float
    votes: list[float] = Field(default_factory=list)
    isRereview: bool = False
    reviewer: str | None = None

    @field_validator("finalScore")
    @classmethod
    def _score_must_be_allowed(cls, value: float) -> float:
        if float(value) not in ALLOWED_FINAL_SCORES:
            raise ValueError("최종 점수는 0, 1, 2, 4, 5점만 가능합니다.")
        return float(value)


class ExcludeDuplicatePayload(BaseModel):
    keepId: str
    excludeId: str
    reviewer: str | None = None


class BulkConfirmPayload(BaseModel):
    edition: int
    reviewer: str | None = None


def _article_not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "ARTICLE_NOT_FOUND", "message": "기사를 찾을 수 없습니다."},
    )


def _db_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "DATABASE_ERROR",
            "message": "DB를 조회하지 못했습니다. DATABASE_URL과 DB 연결을 확인해 주세요.",
        },
    )


# ─── 기사 ────────────────────────────────────────────────────────────────────
@router.get("/articles")
async def list_articles_for_webapp(edition: int | None = None) -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(fetch_articles, edition)
    except Exception as exc:
        raise _db_error(exc) from exc


@router.get("/articles/practitioner-history")
async def practitioner_history(
    name: str,
    exclude: str | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """같은 실천자의 다른 기사(다른 호수 포함) 이력 — 회차 간 중복 확인용."""

    def _load() -> list[dict[str, Any]]:
        target = re.sub(r"\s+", "", name or "")
        if not target:
            return []
        rows = [
            r
            for r in fetch_articles()
            if re.sub(r"\s+", "", r["subject"]) == target and r["id"] != exclude
        ]
        rows.sort(key=lambda r: (str(r.get("date") or ""), r["id"]), reverse=True)
        return rows[: max(1, min(int(limit), 50))]

    try:
        return await asyncio.to_thread(_load)
    except Exception as exc:
        raise _db_error(exc) from exc


@router.post("/articles/bulk-confirm")
async def bulk_confirm(payload: BulkConfirmPayload) -> dict[str, Any]:
    """승인(자동 확정) 상태인데 최종 점수 미확정인 행을 AI 점수 그대로 일괄 확정."""

    def _apply() -> dict[str, Any]:
        reviewer = reviewer_or_default(payload.reviewer)
        return {"confirmed": confirm_approved_rows(payload.edition, reviewer)}

    try:
        return await asyncio.to_thread(_apply)
    except Exception as exc:
        raise _db_error(exc) from exc


@router.get("/articles/{article_id}")
async def get_article_for_webapp(article_id: str) -> dict[str, Any]:
    parse_public_id(article_id)
    try:
        article = await asyncio.to_thread(find_row, article_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc) from exc
    if article is None:
        raise _article_not_found()
    return article


@router.get("/articles/{article_id}/review")
async def get_review_content(article_id: str) -> dict[str, Any]:
    numeric_id, _idx = parse_public_id(article_id)

    def _load() -> dict[str, Any] | None:
        with get_connection() as conn:
            row = conn.execute(ARTICLE_SQL + " WHERE a.id = %s", (numeric_id,)).fetchone()
        if row is None:
            return None
        data = dict(row)
        return build_review_content(data)

    try:
        result = await asyncio.to_thread(_load)
    except Exception as exc:
        raise _db_error(exc) from exc
    if result is None:
        raise _article_not_found()
    return result


@router.patch("/articles/{article_id}")
async def confirm_article(article_id: str, payload: ConfirmPayload) -> dict[str, Any]:
    """검수 확정: (기사, 실천자) 단위로 최종 점수를 DB에 저장한다."""
    numeric_id, idx = parse_public_id(article_id)
    store_idx = idx if idx is not None else 0

    def _apply() -> dict[str, Any] | None:
        with get_connection() as conn:
            exists = conn.execute("SELECT id FROM articles WHERE id = %s", (numeric_id,)).fetchone()
            if exists is None:
                return None
            # 존재하지 않는 실천자 번호(예: 1810-99, 단일 실천자 기사의 1810-1)는 저장 전에 거절
            count = practitioner_count(conn, numeric_id)
            if count >= 2:
                if idx is None or not (1 <= idx <= count):
                    return None
            elif idx is not None:
                return None
            reviewer = reviewer_or_default(payload.reviewer)
            name = practitioner_name(conn, numeric_id, store_idx)
            upsert_review(
                conn,
                numeric_id,
                store_idx,
                review_status="approved",
                final_score=float(payload.finalScore),
                assignee=reviewer,
                practitioner_name=name,
            )
            votes = ", ".join(f"{v:g}" for v in payload.votes) if payload.votes else ""
            detail = f"최종 점수 {payload.finalScore:g}점 확정"
            if name:
                detail += f" — 실천자 {name}"
            if votes:
                detail += f" (투표: {votes})"
            if payload.isRereview:
                detail += " · 재검수"
            log_review_action(
                conn,
                numeric_id,
                "re-review" if payload.isRereview else "confirm",
                detail,
                user_name=reviewer,
            )
            conn.commit()
        return find_row(article_id)

    try:
        article = await asyncio.to_thread(_apply)
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc) from exc
    if article is None:
        raise _article_not_found()
    return article


@router.post("/articles/exclude-duplicate")
async def exclude_duplicate(payload: ExcludeDuplicatePayload) -> list[dict[str, Any]]:
    """중복 제외: 제외 행을 '중복 제외'로 저장하고 두 기사를 서로 연결한다."""
    keep_aid, _keep_idx = parse_public_id(payload.keepId)
    excl_aid, excl_idx = parse_public_id(payload.excludeId)
    excl_store_idx = excl_idx if excl_idx is not None else 0

    if keep_aid == excl_aid:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_DUPLICATE_PAIR",
                "message": "같은 기사끼리는 중복으로 묶을 수 없습니다.",
            },
        )

    def _apply() -> tuple[dict[str, Any], dict[str, Any]] | None:
        with get_connection() as conn:
            found = conn.execute(
                "SELECT DISTINCT id FROM articles WHERE id = ANY(%s)",
                ([keep_aid, excl_aid],),
            ).fetchall()
            if len({int(r["id"]) for r in found}) != len({keep_aid, excl_aid}):
                return None
            upsert_review(
                conn,
                excl_aid,
                excl_store_idx,
                review_status="excluded",
                excluded_with=keep_aid,
                practitioner_name=practitioner_name(conn, excl_aid, excl_store_idx),
            )
            log_review_action(
                conn,
                excl_aid,
                "exclude_duplicate",
                f"기사 {payload.keepId}와(과) 중복으로 제외 처리",
                user_name=reviewer_or_default(payload.reviewer),
            )
            conn.commit()
        kept = find_row(payload.keepId)
        excluded = find_row(payload.excludeId)
        if kept is None or excluded is None:
            return None
        return kept, excluded

    try:
        result = await asyncio.to_thread(_apply)
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc) from exc
    if result is None:
        raise _article_not_found()
    return [result[0], result[1]]


@router.get("/audit")
async def list_audit_logs(articleId: str | None = Query(default=None)) -> list[dict[str, Any]]:
    """검수 이력: 저장된 검수 로그 + 업로드(문서) 이력을 합쳐 반환한다."""

    def _load() -> list[dict[str, Any]]:
        with get_connection() as conn:
            params: list[Any] = []
            where = ""
            numeric_id: int | None = None
            if articleId is not None:
                try:
                    numeric_id = parse_public_id(articleId)[0]
                except HTTPException:
                    return []
                where = "WHERE l.article_id = %s"
                params.append(numeric_id)
            rows = conn.execute(
                f"""
                SELECT l.id, l.article_id, l.action, l.detail, l.user_name, l.created_at
                FROM review_audit_logs l {where}
                ORDER BY l.created_at
                """,
                params,
            ).fetchall()

            uploads: list[dict[str, Any]] = []
            if numeric_id is not None:
                doc = conn.execute(
                    """
                    SELECT d.id, d.original_filename, d.created_at
                    FROM documents d JOIN articles a ON a.document_id = d.id
                    WHERE a.id = %s
                    """,
                    (numeric_id,),
                ).fetchone()
                if doc is not None:
                    uploads.append(
                        {
                            "id": f"doc-{doc['id']}",
                            "articleId": str(numeric_id),
                            "action": "upload",
                            "detail": f"{doc['original_filename']} 업로드 · AI 기사 추출",
                            "userName": "분석 서버",
                            "timestamp": str(doc["created_at"]),
                        }
                    )

        return uploads + [
            {
                "id": str(row["id"]),
                "articleId": str(row["article_id"]),
                "action": str(row["action"]),
                "detail": str(row["detail"]),
                "userName": str(row["user_name"]),
                "timestamp": str(row["created_at"]),
            }
            for row in rows
        ]

    try:
        return await asyncio.to_thread(_load)
    except Exception as exc:
        raise _db_error(exc) from exc


@router.get("/editions")
async def list_editions_for_webapp() -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(list_editions)
    except Exception as exc:
        raise _db_error(exc) from exc


@router.get("/stats")
async def stats_for_webapp(edition: int | None = None) -> dict[str, Any]:
    def _load() -> dict[str, Any]:
        return compute_stats(fetch_articles(edition))

    try:
        return await asyncio.to_thread(_load)
    except Exception as exc:
        raise _db_error(exc) from exc


# ─── 호수 관리 ───────────────────────────────────────────────────────────────
@router.delete("/editions/{edition_id}")
async def delete_edition(edition_id: int) -> dict[str, Any]:
    """호수 삭제: 그 호수로 인식되는 업로드 문서와 기사·채점·검수 기록을 모두 지운다."""

    def _apply() -> dict[str, Any] | None:
        with get_connection() as conn:
            docs = conn.execute("SELECT id, original_filename FROM documents").fetchall()
            targets = [
                d["id"] for d in docs if edition_from_filename(d["original_filename"]) == edition_id
            ]
            if not targets:
                return None
            articles_count = conn.execute(
                "SELECT COUNT(*) AS n FROM articles WHERE document_id = ANY(%s)",
                (targets,),
            ).fetchone()
            conn.execute("DELETE FROM documents WHERE id = ANY(%s)", (targets,))
            conn.commit()
            # DB 기록을 지운 뒤 디스크의 PDF도 정리한다 (실패해도 삭제 자체는 성공으로 본다)
            app_settings = get_settings()
            for doc_id in targets:
                for folder in (app_settings.upload_dir, app_settings.clipped_dir):
                    try:
                        (folder / f"{doc_id}.pdf").unlink(missing_ok=True)
                    except OSError:
                        pass
            return {
                "deletedDocuments": len(targets),
                "deletedArticles": int(articles_count["n"]),
            }

    try:
        result = await asyncio.to_thread(_apply)
    except Exception as exc:
        raise _db_error(exc) from exc
    if result is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "EDITION_NOT_FOUND", "message": "해당 호수의 업로드 문서가 없습니다."},
        )
    return result


def _editions_managed_error() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "EDITIONS_AUTO_MANAGED",
            "message": "DB 모드에서는 호수가 업로드 PDF 파일명(예: 한가족신문_909호.pdf)으로 자동 관리됩니다.",
        },
    )


@router.post("/editions")
async def create_edition_unsupported() -> None:
    raise _editions_managed_error()


class EditionMetaPayload(BaseModel):
    label: str | None = None
    month: str | None = None
    week: int | None = None  # 주차는 더 이상 사용하지 않음 (무시)


@router.patch("/editions/{edition_id}")
async def update_edition(edition_id: int, payload: EditionMetaPayload) -> dict[str, Any]:
    """호수의 발행월·라벨을 지정한다 (호수 관리 탭의 수정 버튼)."""

    def _apply() -> dict[str, Any] | None:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO edition_meta (edition_id, label, month, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (edition_id) DO UPDATE
                SET label = COALESCE(EXCLUDED.label, edition_meta.label),
                    month = COALESCE(EXCLUDED.month, edition_meta.month),
                    updated_at = NOW()
                """,
                (
                    edition_id,
                    (payload.label or "").strip() or None,
                    (payload.month or "").strip() or None,
                ),
            )
            conn.commit()
        for edition in list_editions():
            if edition["id"] == edition_id:
                return edition
        # 방금 업로드되어 아직 기사 추출 전인 호수 — 저장은 완료됐으므로 기본 정보 반환
        return {
            "id": edition_id,
            "label": f"{edition_id}호",
            "month": (payload.month or "").strip(),
            "monthSource": "manual",
            "status": "업로드 대기",
            "articleCount": 0,
        }

    try:
        edition = await asyncio.to_thread(_apply)
    except Exception as exc:
        raise _db_error(exc) from exc
    return edition


@router.post("/editions/reset-mock")
async def reset_mock_unsupported() -> None:
    raise _editions_managed_error()
