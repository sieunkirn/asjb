"""Load extracted articles.json into PostgreSQL."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from db import database_label, init_db, list_pending_articles, upsert_articles_from_payload


def load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}")
    if "pdf" not in payload:
        # Allow bare {"articles": [...]} by requiring --pdf
        payload = dict(payload)
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Upsert extracted articles into PostgreSQL for later evaluation.",
    )
    parser.add_argument(
        "--json",
        type=Path,
        default=None,
        help="Path to articles.json from extract_pdf / main.py",
    )
    parser.add_argument(
        "--pdf",
        type=str,
        default=None,
        help="Override pdf path when the JSON envelope omits it",
    )
    parser.add_argument(
        "--init-only",
        action="store_true",
        help="Only create the DB schema, do not load articles",
    )
    args = parser.parse_args(argv)

    db_label = init_db()
    print(f"db={db_label}")

    if args.init_only:
        return 0

    if args.json is None:
        print("--json is required unless --init-only is set", file=sys.stderr)
        return 1

    if not args.json.exists():
        print(f"JSON not found: {args.json}", file=sys.stderr)
        return 1

    payload = load_json(args.json)
    if args.pdf:
        payload["pdf"] = args.pdf
    if not payload.get("pdf"):
        print(
            "JSON has no 'pdf' field; pass --pdf to set the source document path.",
            file=sys.stderr,
        )
        return 1

    stats = upsert_articles_from_payload(payload, source_json_path=args.json)
    pending = list_pending_articles()
    print(
        f"upserted total={stats['total']} inserted={stats['inserted']} updated={stats['updated']}"
    )
    print(f"pending_evaluations={len(pending)}")
    print(f"db={database_label()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
