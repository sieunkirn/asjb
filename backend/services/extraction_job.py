"""Background extraction job for uploaded documents."""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from article_extract import extract_articles_from_page_image
from db import (
    get_connection,
    update_document_progress,
    update_document_status,
    upsert_articles_from_payload,
)
from services.openai_client import get_client
from utils.pdf_pages import render_page_jpeg

logger = logging.getLogger(__name__)

# Number of pages sent to the Vision API at the same time. 6 is the sweet
# spot for a Tier 1 key (30k TPM); raise it on Tier 2+ for more speed.
EXTRACTION_CONCURRENCY = max(1, int(os.getenv("EXTRACTION_CONCURRENCY", "6")))

_FATAL_ERROR_NAMES = {
    "OpenAIConfigError",
    "AuthenticationError",
    "PermissionDeniedError",
    "NotFoundError",
    "BadRequestError",
    "FileNotFoundError",
    "EmptyFileError",
    "FileDataError",
}
# RateLimitError · APITimeoutError · APIConnectionError 는 일시적일 수 있어
# 문서 전체를 실패시키지 않고 해당 페이지만 '검토 필요'로 남긴다.
# (모든 페이지가 이런 오류로 실패하면 process_document 끝에서 문서를 failed 처리)


def _review_placeholder(page_number: int, reason: str) -> dict[str, object]:
    return {
        "title": "",
        "writer": "",
        "target": "",
        "content": "",
        "needs_review": True,
        "review_reasons": [reason],
        "source_page": page_number,
    }


def _is_fatal_service_error(exc: BaseException) -> bool:
    """Detect configuration/auth/network failures that affect every page."""
    current: BaseException | None = exc
    visited: set[int] = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        if type(current).__name__ in _FATAL_ERROR_NAMES:
            return True
        current = current.__cause__ or current.__context__
    return False


def process_document(
    *,
    document_id: str,
    pdf_path: str,
    original_filename: str,
    page_indices: list[int],
    dpi: int = 200,
    keep_uploaded_file: bool = True,
) -> None:
    """Extract selected pages one by one and persist progress/results."""
    source_ref = f"upload://{document_id}/{original_filename}"
    processed_pages = 0
    total_articles = 0
    page_errors: list[str] = []
    transient_failed_pages = 0
    source_path = Path(pdf_path)

    try:
        update_document_status(document_id, status="processing")

        # Fail once, rather than creating an error article for every page, when
        # the API key itself is missing.
        get_client()

        def _extract_page(page_index: int) -> list[dict[str, object]]:
            """Render one page and extract its articles (runs in a worker)."""
            jpeg_bytes = render_page_jpeg(
                source_path,
                page_index,
                dpi=dpi,
            )
            return extract_articles_from_page_image(
                jpeg_bytes,
                page_number=page_index + 1,
                image_mime="image/jpeg",
            )

        # Pages are independent, so the slow Vision API calls run
        # concurrently. DB writes stay on this thread, one page at a time,
        # in whatever order pages finish.
        max_workers = min(EXTRACTION_CONCURRENCY, max(1, len(page_indices)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_page = {
                executor.submit(_extract_page, page_index): page_index
                for page_index in page_indices
            }
            try:
                for future in as_completed(future_to_page):
                    page_number = future_to_page[future] + 1
                    try:
                        articles = future.result()

                        if not articles:
                            reason = "no_articles_extracted"
                            articles = [_review_placeholder(page_number, reason)]
                            page_errors.append(f"{page_number}:{reason}")

                    except Exception as exc:
                        if _is_fatal_service_error(exc):
                            raise

                        logger.exception(
                            "Article extraction failed: document=%s page=%s",
                            document_id,
                            page_number,
                        )
                        reason = f"extract_error:{type(exc).__name__}"
                        articles = [_review_placeholder(page_number, reason)]
                        page_errors.append(f"{page_number}:{reason}")
                        transient_failed_pages += 1

                    for article in articles:
                        article["source_page"] = page_number

                    payload = {
                        "document_id": document_id,
                        "pdf": source_ref,
                        "articles": articles,
                        "pages_processed": [page_number],
                    }

                    # One short-lived DB connection per page. It is opened
                    # only after the OpenAI request has finished.
                    with get_connection() as conn:
                        upsert_articles_from_payload(payload, conn=conn)
                        processed_pages += 1
                        total_articles += len(articles)
                        update_document_progress(
                            document_id,
                            processed_pages=processed_pages,
                            article_count=total_articles,
                            conn=conn,
                        )
            except BaseException:
                # A fatal error (missing key, auth, network) affects every
                # page — do not let queued pages keep calling the API.
                for pending in future_to_page:
                    pending.cancel()
                raise

        if page_indices and transient_failed_pages == len(page_indices):
            # 모든 페이지가 실패 = 네트워크 · 한도 문제로 추출이 전혀 안 된 것
            raise RuntimeError(
                "모든 페이지의 기사 추출에 실패했습니다. "
                "OpenAI 연결 · 사용 한도를 확인한 뒤 다시 업로드해 주세요."
            )

        if page_errors:
            message = "검토가 필요한 페이지: " + ", ".join(page_errors)
            update_document_status(
                document_id,
                status="completed_with_errors",
                error_message=message[:1000],
                article_count=total_articles,
                processed_pages=processed_pages,
            )
        else:
            update_document_status(
                document_id,
                status="completed",
                article_count=total_articles,
                processed_pages=processed_pages,
            )

        if not keep_uploaded_file:
            source_path.unlink(missing_ok=True)

    except Exception as exc:
        logger.exception("Document extraction job failed: %s", document_id)
        try:
            update_document_status(
                document_id,
                status="failed",
                error_message=f"{type(exc).__name__}: {str(exc)[:800]}",
                article_count=total_articles,
                processed_pages=processed_pages,
            )
        except Exception:
            logger.exception(
                "Could not persist failed status for document: %s",
                document_id,
            )
