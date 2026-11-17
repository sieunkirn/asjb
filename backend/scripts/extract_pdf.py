"""Extract all pages from a clipped love-article PDF.

Modes:
  --text-only   Dump page text via PyMuPDF (no API).
  default       Page-wise Vision structured extraction (API).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from article_extract import extract_articles_from_page_image
from db import database_label, upsert_articles_from_payload
from utils.pdf_pages import render_love_pages
from utils.pdf_reader import read_pdf_by_page


def dump_text(pdf_path: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    pages = read_pdf_by_page(pdf_path)
    combined_parts: list[str] = []
    for page in pages:
        n = page["page_number"]
        text = page["text"] or ""
        page_file = out_dir / f"page_{n:03d}.txt"
        page_file.write_text(text, encoding="utf-8")
        combined_parts.append(f"===== PAGE {n} =====\n{text.rstrip()}\n")

    combined = out_dir / "all_pages.txt"
    combined.write_text("\n".join(combined_parts), encoding="utf-8")
    meta = {
        "pdf": str(pdf_path),
        "page_count": len(pages),
        "total_chars": sum(len(p.get("text") or "") for p in pages),
        "empty_pages": [p["page_number"] for p in pages if not (p.get("text") or "").strip()],
    }
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return combined


def extract_vision(
    pdf_path: Path,
    out_dir: Path,
    *,
    dpi: int = 200,
    start_page: int = 1,
    max_pages: int | None = None,
    save_to_db: bool = True,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    result_path = out_dir / "articles.json"
    log_path = out_dir / "progress.log"

    # All pages in a clipped love PDF (0-based indices).
    import fitz

    doc = fitz.open(pdf_path)
    total = doc.page_count
    doc.close()

    start_index = max(0, start_page - 1)
    end_index = total if max_pages is None else min(total, start_index + max_pages)
    indices = list(range(start_index, end_index))

    # Resume support: load existing articles if present.
    merged: list[dict] = []
    done_pages: set[int] = set()
    if result_path.exists():
        prev = json.loads(result_path.read_text(encoding="utf-8"))
        merged = list(prev.get("articles") or [])
        done_pages = {int(a["source_page"]) for a in merged if a.get("source_page")}

    def log(msg: str) -> None:
        line = f"{datetime.now(UTC).isoformat()} {msg}"
        print(line, flush=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    log(f"pdf={pdf_path.name} total={total} range={start_index + 1}-{end_index}")

    for page_index in indices:
        page_number = page_index + 1
        if page_number in done_pages:
            log(f"skip page {page_number} (already done)")
            continue

        pages = render_love_pages(pdf_path, page_indices=[page_index], dpi=dpi)
        if not pages:
            log(f"warn page {page_number}: render empty")
            continue

        page = pages[0]
        try:
            articles = extract_articles_from_page_image(
                page.png_bytes,
                page_number=page.page_number,
            )
        except Exception as exc:  # noqa: BLE001 - keep batch going
            log(f"ERROR page {page_number}: {exc}")
            # Persist a placeholder so resume can skip or retry later.
            articles = [
                {
                    "title": "",
                    "writer": "",
                    "target": "",
                    "content": "",
                    "needs_review": True,
                    "review_reasons": [f"extract_error:{type(exc).__name__}"],
                    "source_page": page_number,
                }
            ]

        for article in articles:
            article["source_page"] = page_number
        merged.extend(articles)
        done_pages.add(page_number)

        payload = {
            "pdf": str(pdf_path),
            "articles": merged,
            "pages_processed": sorted(done_pages),
            "article_count": len(merged),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        result_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        log(f"page {page_number}/{end_index}: +{len(articles)} articles (total={len(merged)})")

    if save_to_db and result_path.exists():
        try:
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            stats = upsert_articles_from_payload(
                payload,
                source_json_path=result_path,
            )
            log(
                f"db upsert: total={stats['total']} "
                f"inserted={stats['inserted']} updated={stats['updated']} "
                f"path={database_label()}"
            )
        except Exception as exc:  # noqa: BLE001 - surface but do not fail extract
            log(f"ERROR db upsert: {exc}")

    return result_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--pdf",
        type=Path,
        required=True,
        help="Input PDF path",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=PROJECT_ROOT / "output" / "954_love_extract",
    )
    parser.add_argument("--text-only", action="store_true")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Skip automatic PostgreSQL upsert after extraction",
    )
    args = parser.parse_args(argv)

    if not args.pdf.exists():
        print(f"PDF not found: {args.pdf}", file=sys.stderr)
        return 1

    if args.text_only:
        combined = dump_text(args.pdf, args.out / "text")
        meta = json.loads((args.out / "text" / "meta.json").read_text(encoding="utf-8"))
        print(f"pages={meta['page_count']} chars={meta['total_chars']}")
        print(f"empty_pages={meta['empty_pages']}")
        print(f"wrote {combined}")
        return 0

    result_path = extract_vision(
        args.pdf,
        args.out / "vision",
        dpi=args.dpi,
        start_page=args.start_page,
        max_pages=args.max_pages,
        save_to_db=not args.no_db,
    )
    print(f"wrote {result_path}")
    if not args.no_db:
        print(f"db={database_label()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
