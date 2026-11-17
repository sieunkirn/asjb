"""Love-article page filtering, rendering, and PDF clipping helpers."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import fitz

DEFAULT_KEYWORDS = ("사랑의 챔피언",)
DEFAULT_SUPPORT_KEYWORDS = ("RAINBOW ORANGE",)
DEFAULT_RENDER_DPI = 200


class LovePagesNotFoundError(ValueError):
    """Raised when no love-article pages can be detected."""


@dataclass(frozen=True)
class PageImage:
    """One rendered PDF page ready for Vision extraction."""

    page_index: int  # 0-based
    page_number: int  # 1-based
    png_bytes: bytes
    text_preview: str


def _compact_text(value: str) -> str:
    """Remove whitespace so keywords split by PDF text layout still match."""
    return "".join(value.split())


def _contains_keyword(text: str, keywords: Sequence[str]) -> bool:
    compact_text = _compact_text(text)
    return any(_compact_text(keyword) in compact_text for keyword in keywords)


def _has_love_article_header(
    page: fitz.Page,
    keywords: Sequence[str],
    *,
    header_ratio: float = 0.25,
) -> bool:
    """Return True when a keyword appears near the top of a page."""
    header_bottom = page.rect.height * header_ratio
    header_parts: list[str] = []

    for block in page.get_text("blocks"):
        _x0, y0, _x1, _y1, text, *_rest = block
        if y0 <= header_bottom:
            header_parts.append(str(text or ""))

    return _contains_keyword("\n".join(header_parts), keywords)


def find_love_page_indices(
    pdf_path: str | Path,
    keywords: tuple[str, ...] = DEFAULT_KEYWORDS,
    *,
    include_cover: bool = False,
    header_first: bool = True,
    support_keywords: tuple[str, ...] = DEFAULT_SUPPORT_KEYWORDS,
) -> list[int]:
    """
    Return 0-based page indices containing a love-article section keyword.

    All pages are scanned. Page 0 is excluded only when it looks like a cover
    summary: it contains the section name but not the usual love-page support
    marker (for example ``RAINBOW ORANGE``). This also preserves page 0 when
    the user uploads an already-clipped love-article PDF.
    """
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")
    if not keywords:
        raise ValueError("At least one page keyword is required.")

    doc = fitz.open(str(path))
    found: list[int] = []
    supported: set[int] = set()

    try:
        for page_index in range(doc.page_count):
            page = doc.load_page(page_index)
            text = page.get_text("text") or ""

            has_keyword = (
                header_first and _has_love_article_header(page, keywords)
            ) or _contains_keyword(text, keywords)

            if not has_keyword:
                continue

            found.append(page_index)
            if support_keywords and _contains_keyword(text, support_keywords):
                supported.add(page_index)

        if not include_cover and doc.page_count > 1 and 0 in found and 0 not in supported:
            found.remove(0)
    finally:
        doc.close()

    return found


def render_page_jpeg(
    pdf_path: str | Path,
    page_index: int,
    *,
    dpi: int = DEFAULT_RENDER_DPI,
    quality: int = 80,
) -> bytes:
    """Render one 0-based PDF page to JPEG bytes.

    JPEG is several times smaller than PNG for magazine pages, which cuts
    the upload time of each Vision API request.
    """
    path = Path(pdf_path)
    doc = fitz.open(str(path))
    try:
        if page_index < 0 or page_index >= doc.page_count:
            raise IndexError(f"page_index out of range: {page_index} (page_count={doc.page_count})")
        page = doc.load_page(page_index)
        zoom = dpi / 72.0
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("jpg", jpg_quality=quality)
    finally:
        doc.close()


def render_love_pages(
    pdf_path: str | Path,
    *,
    keywords: tuple[str, ...] = DEFAULT_KEYWORDS,
    dpi: int = DEFAULT_RENDER_DPI,
    page_indices: list[int] | None = None,
    include_cover: bool = False,
) -> list[PageImage]:
    """
    Filter love-article pages and render each to PNG.

    If page_indices is provided, those pages are rendered as-is without a
    second keyword scan.
    """
    path = Path(pdf_path)
    indices = (
        page_indices
        if page_indices is not None
        else find_love_page_indices(path, keywords, include_cover=include_cover)
    )

    doc = fitz.open(str(path))
    pages: list[PageImage] = []
    try:
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for page_index in indices:
            if page_index < 0 or page_index >= doc.page_count:
                raise IndexError(
                    f"page_index out of range: {page_index} (page_count={doc.page_count})"
                )
            page = doc.load_page(page_index)
            text_preview = (page.get_text("text") or "").strip()
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            pages.append(
                PageImage(
                    page_index=page_index,
                    page_number=page_index + 1,
                    png_bytes=pix.tobytes("png"),
                    text_preview=text_preview[:500],
                )
            )
    finally:
        doc.close()

    return pages


def save_selected_pages_pdf(
    input_pdf: str | Path,
    output_pdf: str | Path,
    page_indices: Iterable[int],
) -> list[int]:
    """Copy selected 0-based pages to a new PDF and return 1-based numbers."""
    input_path = Path(input_pdf)
    output_path = Path(output_pdf)
    indices = list(dict.fromkeys(int(index) for index in page_indices))

    if not indices:
        raise LovePagesNotFoundError("사랑기사 페이지가 없습니다.")

    src = fitz.open(str(input_path))
    dst = fitz.open()
    try:
        for page_index in indices:
            if page_index < 0 or page_index >= src.page_count:
                raise IndexError(
                    f"page_index out of range: {page_index} (page_count={src.page_count})"
                )
            dst.insert_pdf(src, from_page=page_index, to_page=page_index)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.exists():
            output_path.unlink()
        dst.save(str(output_path), garbage=4, deflate=True)
    finally:
        dst.close()
        src.close()

    return [index + 1 for index in indices]


def save_clipped_love_pdf(
    input_pdf: str | Path,
    output_pdf: str | Path,
    *,
    keywords: tuple[str, ...] = DEFAULT_KEYWORDS,
    include_cover: bool = False,
) -> list[int]:
    """Detect and save only love-article pages into a new PDF."""
    indices = find_love_page_indices(
        input_pdf,
        keywords,
        include_cover=include_cover,
    )
    return save_selected_pages_pdf(input_pdf, output_pdf, indices)
