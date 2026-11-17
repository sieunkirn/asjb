"""Background jobs for scoring extracted love articles."""

from __future__ import annotations

import logging
import os
from concurrent.futures import (
    ThreadPoolExecutor,
    as_completed,
)

from db import (
    claim_evaluation_processing,
    get_article,
    get_document,
    get_evaluation,
    list_articles,
    save_evaluation_error,
    save_evaluation_result,
)
from services.openai_client import (
    DEFAULT_MODEL,
    get_client,
)
from services.scoring_service import (
    ScoringValidationError,
    score_article,
)

logger = logging.getLogger(__name__)

# 동시에 채점할 기사 수.
# Tier 1 키 기준 8이 안정적이며,
# Tier 2 이상이면 더 올려도 된다.
SCORING_CONCURRENCY = max(
    1,
    int(
        os.getenv(
            "SCORING_CONCURRENCY",
            "8",
        )
    ),
)


def _score_and_persist(
    article: dict,
    *,
    force: bool,
) -> bool:
    """
    기사 한 편을 평가하고 DB에 저장한다.
    """

    article_id = int(article["id"])

    # DB에서 원자적으로 '평가 시작 권한'을 얻는다.
    # 이미 다른 작업이 진행 중이거나(중복 클릭 · 문서/기사 동시 요청),
    # force 없이 이미 완료된 기사면 건너뛴다 -> GPT 중복 호출 방지.
    claimed = claim_evaluation_processing(
        article_id,
        model=DEFAULT_MODEL,
        force=force,
    )

    if claimed is None:
        return False

    try:
        # GPT가 규칙 계약(rule_id 등)을 어긴 응답은
        # 새로 호출하면 대부분 정상으로 돌아온다.
        try:
            result = score_article(article)

        except (
            ScoringValidationError,
            ValueError,
        ):
            result = score_article(article)

        save_evaluation_result(
            article_id,
            # 자동 확정된 실천자 점수 합계
            score=float(result["auto_score_total"]),
            rationale=(result.get("article_action_summary") or ""),
            model=DEFAULT_MODEL,
            # 사람별 점수·근거·검토 결과 전체
            raw_result=result,
        )

        return True

    except Exception as exc:
        logger.exception(
            "Love-article scoring failed: article_id=%s",
            article_id,
        )

        save_evaluation_error(
            article_id,
            model=DEFAULT_MODEL,
            error_message=(f"{type(exc).__name__}: {str(exc)[:800]}"),
        )

        return False


def _auto_confirm_enabled() -> bool:
    return os.getenv("AUTO_CONFIRM_AFTER_SCORING", "").strip().lower() in {"1", "true", "yes", "on"}


def _auto_confirm_document(document_id: str) -> None:
    """
    채점이 끝난 문서의 '확실한 건'(AI가 자동 확정하는 4번·5번·점수제외 유형, 경고 없음)을
    사람 검수 없이 바로 확정한다. 사람이 봐야 하는 건(1번·2번·기타, 추출 경고)은 건드리지 않는다.
    기본은 꺼져 있고 AUTO_CONFIRM_AFTER_SCORING=1 로 켠다. 실패해도 채점 결과에는 영향이 없다.
    """
    try:
        # 순환 import 방지를 위해 필요할 때 불러온다
        from services.review_service import AUTO_REVIEWER, confirm_approved_rows
        from services.review_view import edition_from_filename

        document = get_document(document_id)
        edition = edition_from_filename((document or {}).get("original_filename"))
        confirmed = confirm_approved_rows(edition, AUTO_REVIEWER, label="자동 확정")
        logger.info(
            "Auto-confirmed %s rows: document=%s edition=%s", confirmed, document_id, edition
        )
    except Exception:
        logger.exception("Auto-confirm failed: document=%s", document_id)


def process_document_scoring(
    document_id: str,
    *,
    force: bool = False,
) -> None:
    """
    한 문서에 포함된 모든 기사를 순차적으로 평가한다.
    """

    articles = list_articles(document_id=document_id)

    # API 키가 없는 경우 기사마다 OpenAI를
    # 반복 호출하지 않고 먼저 실패 처리한다.
    try:
        get_client()

    except Exception as exc:
        message = f"{type(exc).__name__}: {str(exc)[:800]}"

        for article in articles:
            article_id = int(article["id"])

            existing = get_evaluation(article_id)

            if existing and existing.get("status") == "done" and not force:
                continue

            save_evaluation_error(
                article_id,
                model=DEFAULT_MODEL,
                error_message=message,
            )

        return

    # 기사들은 서로 독립적이므로 LLM 호출을
    # 병렬로 실행한다. DB 저장은 각 워커가
    # 자기 연결로 처리한다.
    max_workers = min(
        SCORING_CONCURRENCY,
        max(1, len(articles)),
    )

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _score_and_persist,
                article,
                force=force,
            ): article
            for article in articles
        }

        for future in as_completed(futures):
            try:
                future.result()

            except Exception:
                # _score_and_persist가 내부에서
                # 오류를 저장하므로 여기는 DB 장애
                # 같은 예외만 도달한다. 다른 기사
                # 채점은 계속 진행한다.
                article = futures[future]

                logger.exception(
                    "Scoring worker failed: article_id=%s",
                    article.get("id"),
                )

    if _auto_confirm_enabled():
        _auto_confirm_document(document_id)


def process_single_article_scoring(
    article_id: int,
    *,
    force: bool = True,
) -> None:
    """
    기사 한 편만 재평가한다.
    """

    article = get_article(article_id)

    if article is None:
        logger.error(
            "Article not found: article_id=%s",
            article_id,
        )

        return

    _score_and_persist(
        article,
        force=force,
    )
