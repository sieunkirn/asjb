"""Text-layer helpers for debugging magazine layout (not the primary extract path)."""

from __future__ import annotations

from pathlib import Path

import fitz


def read_pdf_by_page(pdf_path: str | Path) -> list[dict]:
    """
    Return per-page text for layout debugging.

    Each item: {"page_number": int, "text": str, "block_count": int}
    """
    pdf = fitz.open(pdf_path)
    pages: list[dict] = []
    try:
        for index, page in enumerate(pdf):
            text = page.get_text() or ""
            blocks = page.get_text("blocks") or []
            text_blocks = [b for b in blocks if len(b) >= 7 and b[6] == 0]
            pages.append(
                {
                    "page_number": index + 1,
                    "text": text,
                    "block_count": len(text_blocks),
                }
            )
    finally:
        pdf.close()
    return pages
