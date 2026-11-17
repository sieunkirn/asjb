"""CLI entry: local PDF → love-page filtering → Vision extraction."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from article_extract import extract_articles_from_pdf
from db import database_label, upsert_articles_from_payload
from utils.pdf_pages import save_clipped_love_pdf

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_JSON = PROJECT_ROOT / "output" / "articles.json"
DEFAULT_CLIPPED_PDF = PROJECT_ROOT / "output" / "love_pages_clipped.pdf"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract love articles from a local magazine PDF.")
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Input PDF path",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_JSON,
        help="Output JSON path",
    )
    parser.add_argument(
        "--save-clipped-pdf",
        type=Path,
        default=None,
        nargs="?",
        const=DEFAULT_CLIPPED_PDF,
        help="Also save only detected love-article pages",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=200,
        help="Page render DPI for Vision extraction",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Skip PostgreSQL upsert",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    input_pdf = args.input.expanduser().resolve()

    if not input_pdf.is_file():
        print(f"Input PDF not found: {input_pdf}", file=sys.stderr)
        return 1
    if input_pdf.suffix.lower() != ".pdf":
        print(f"Input must be a PDF: {input_pdf}", file=sys.stderr)
        return 1

    if args.save_clipped_pdf is not None:
        found = save_clipped_love_pdf(input_pdf, args.save_clipped_pdf)
        print(f"Clipped love pages (1-based): {found}")
        print(f"Saved clipped PDF: {args.save_clipped_pdf}")

    result = extract_articles_from_pdf(str(input_pdf), dpi=args.dpi)
    payload = {
        "pdf": str(input_pdf),
        **result,
        "article_count": len(result.get("articles") or []),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Pages processed: {result.get('pages_processed')}")
    print(f"Articles extracted: {len(result.get('articles') or [])}")
    print(f"Wrote: {args.output}")

    if not args.no_db:
        stats = upsert_articles_from_payload(
            payload,
            source_json_path=args.output,
        )
        print(
            f"DB upsert: total={stats['total']} "
            f"inserted={stats['inserted']} updated={stats['updated']}"
        )
        print(f"db={database_label()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
