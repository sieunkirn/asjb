"""Love-article extraction: page-wise Vision LLM is the primary path."""

from __future__ import annotations

import re
from typing import Any

from prompts.article_prompt import SYSTEM_PROMPT, USER_TEXT
from services.openai_client import call_vision_json
from utils.pdf_pages import PageImage, render_love_pages


def _normalize_article(raw: dict[str, Any]) -> dict[str, Any]:
    article = {
        "title": str(raw.get("title") or "").strip(),
        "writer": str(raw.get("writer") or "").strip(),
        "target": str(raw.get("target") or "").strip(),
        "content": str(raw.get("content") or "").strip(),
        "needs_review": bool(raw.get("needs_review", False)),
        "review_reasons": list(raw.get("review_reasons") or []),
    }
    return apply_review_heuristics(article)


# 호칭('님')이 붙어 있어도 사람 이름이 함께 있으면 정상 표기로 본다.
# (예: '임영진 대표이사님', '홍주님' → 확인 불필요 / '고객님', '셰프님' → 확인 필요)
_TITLE_ONLY_WORDS = {
    "대표이사",
    "이사",
    "전무",
    "전무이사",
    "상무",
    "부사장",
    "사장",
    "부장",
    "차장",
    "과장",
    "대리",
    "주임",
    "계장",
    "팀장",
    "실장",
    "본부장",
    "점장",
    "매니저",
    "셰프",
    "기사",
    "선생",
    "선생님",
    "선배",
    "고객",
    "사모",
    "여사",
    "어르신",
    "직원",
}


def _honorific_without_name(target: str) -> bool:
    """호칭('님')만 있고 이름으로 볼 만한 표기가 전혀 없는지 검사한다."""
    for chunk in re.split(r"[,/·]", target):
        for token in chunk.split():
            word = token.strip().rstrip(",").removesuffix("님")
            if not word or word in _TITLE_ONLY_WORDS:
                continue
            if len(word) >= 2:
                return False
    return True


def apply_review_heuristics(article: dict[str, Any]) -> dict[str, Any]:
    """Flag articles that likely need human review."""
    reasons = list(article.get("review_reasons") or [])

    for field in ("title", "writer", "target", "content"):
        if not article.get(field):
            reason = f"missing_{field}"
            if reason not in reasons:
                reasons.append(reason)

    content = article.get("content") or ""
    if content and len(content) < 40:
        if "short_content" not in reasons:
            reasons.append("short_content")

    target = article.get("target") or ""
    if (" 님" in target or target.endswith("님")) and _honorific_without_name(target):
        if "honorific_in_target" not in reasons:
            reasons.append("honorific_in_target")

    section_noise = ("사랑의 챔피언", "RAINBOW ORANGE", "RAINBOW")
    title = article.get("title") or ""
    if any(noise in title for noise in section_noise):
        if "section_header_as_title" not in reasons:
            reasons.append("section_header_as_title")

    article["review_reasons"] = reasons
    article["needs_review"] = bool(reasons) or bool(article.get("needs_review"))
    return article


def extract_articles_from_page_image(
    png_bytes: bytes,
    *,
    page_number: int | None = None,
    image_mime: str = "image/png",
) -> list[dict[str, Any]]:
    """Extract articles from a single rendered page image via Vision LLM."""
    user_text = USER_TEXT
    if page_number is not None:
        user_text = f"{USER_TEXT}\nThis is magazine page {page_number}."

    result = call_vision_json(
        system_prompt=SYSTEM_PROMPT,
        user_text=user_text,
        image_bytes=png_bytes,
        image_mime=image_mime,
    )
    articles = result.get("articles") or []
    if not isinstance(articles, list):
        raise ValueError("Vision response 'articles' must be a list.")
    return [_normalize_article(a) for a in articles if isinstance(a, dict)]


def extract_articles_from_pdf(
    pdf_path: str,
    *,
    page_indices: list[int] | None = None,
    dpi: int = 200,
) -> dict[str, Any]:
    """
    Primary pipeline: filter love pages → render → vision extract → merge.

    Returns {"articles": [...], "pages_processed": [1-based ints]}.
    """
    pages: list[PageImage] = render_love_pages(
        pdf_path,
        page_indices=page_indices,
        dpi=dpi,
    )
    merged: list[dict[str, Any]] = []
    pages_processed: list[int] = []

    for page in pages:
        page_articles = extract_articles_from_page_image(
            page.png_bytes,
            page_number=page.page_number,
        )
        for article in page_articles:
            article["source_page"] = page.page_number
        merged.extend(page_articles)
        pages_processed.append(page.page_number)

    return {
        "articles": merged,
        "pages_processed": pages_processed,
    }
