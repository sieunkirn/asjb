"""Smoke-test Vision extraction on one page of an explicitly supplied PDF."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from article_extract import extract_articles_from_pdf
from utils.pdf_pages import find_love_page_indices


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument(
        "--page",
        type=int,
        default=None,
        help="1-based page number. Omit to use the first detected love page.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=PROJECT_ROOT / "output" / "smoke_one_page.json",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pdf = args.pdf.expanduser().resolve()
    if not pdf.is_file():
        print(f"PDF not found: {pdf}", file=sys.stderr)
        return 1

    if args.page is not None:
        if args.page < 1:
            print("--page must be at least 1", file=sys.stderr)
            return 1
        page_indices = [args.page - 1]
    else:
        found = find_love_page_indices(pdf)
        if not found:
            print(f"No love pages in {pdf.name}", file=sys.stderr)
            return 1
        page_indices = found[:1]

    print(f"PDF: {pdf.name}")
    print(f"page_indices (0-based): {page_indices}")
    result = extract_articles_from_pdf(
        str(pdf),
        page_indices=page_indices,
        dpi=200,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    articles = result.get("articles") or []
    print(f"pages_processed: {result.get('pages_processed')}")
    print(f"article_count: {len(articles)}")
    for index, article in enumerate(articles, 1):
        print(f"--- article {index} ---")
        print(f"title: {article.get('title')}")
        print(f"writer: {article.get('writer')}")
        print(f"target: {article.get('target')}")
        print(f"needs_review: {article.get('needs_review')} {article.get('review_reasons')}")
        content = article.get("content") or ""
        print(f"content_len: {len(content)}")
        print(f"content_preview: {content[:160].replace(chr(10), ' ')}")
    print(f"wrote: {args.out}")
    return 0 if articles else 1


if __name__ == "__main__":
    raise SystemExit(main())
