from pathlib import Path

import fitz

from utils.pdf_pages import (
    find_love_page_indices,
    save_selected_pages_pdf,
)


def _make_pdf(path: Path) -> None:
    doc = fitz.open()
    for text in ("cover", "LOVE ARTICLE\ntest", "normal article"):
        page = doc.new_page()
        page.insert_text((72, 72), text, fontsize=14)
    doc.save(path)
    doc.close()


def test_find_and_clip_love_page(tmp_path: Path) -> None:
    source = tmp_path / "sample.pdf"
    clipped = tmp_path / "clipped.pdf"
    _make_pdf(source)

    indices = find_love_page_indices(source, ("LOVE ARTICLE",))
    assert indices == [1]

    numbers = save_selected_pages_pdf(source, clipped, indices)
    assert numbers == [2]

    result = fitz.open(clipped)
    try:
        assert result.page_count == 1
    finally:
        result.close()


def test_first_page_is_kept_for_already_clipped_pdf(tmp_path: Path) -> None:
    source = tmp_path / "already_clipped.pdf"
    doc = fitz.open()
    for _ in range(2):
        page = doc.new_page()
        page.insert_text((72, 72), "LOVE ARTICLE\nRAINBOW ORANGE")
    doc.save(source)
    doc.close()

    indices = find_love_page_indices(
        source,
        ("LOVE ARTICLE",),
        support_keywords=("RAINBOW ORANGE",),
    )
    assert indices == [0, 1]
