"""
Regression check against the love-article sample PDF.

Usage:
  python eval/run_sample.py --pdf "C:/path/to/sample.pdf"
  python eval/run_sample.py --pdf "C:/path/to/사랑기사 pdf 샘플.pdf"
  python eval/run_sample.py --offline   # validate heuristics only, no API call
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

EXPECTED_PATH = Path(__file__).resolve().parent / "sample_expected.json"


def resolve_pdf(explicit: Path | None) -> Path:
    if explicit is None:
        raise FileNotFoundError("Pass the sample PDF explicitly with --pdf <path>.")
    pdf = explicit.expanduser().resolve()
    if not pdf.is_file():
        raise FileNotFoundError(f"PDF not found: {pdf}")
    return pdf


def _norm_name(value: str) -> str:
    return "".join(value.split())


def _targets_match(expected: str, actual: str) -> bool:
    exp_parts = {_norm_name(p) for p in expected.split(",") if p.strip()}
    act_parts = {_norm_name(p) for p in actual.split(",") if p.strip()}
    return exp_parts == act_parts


def score_articles(expected: list[dict], actual: list[dict]) -> list[str]:
    errors: list[str] = []

    if len(actual) != len(expected):
        errors.append(f"article_count: expected {len(expected)}, got {len(actual)}")

    by_title = {_norm_name(a.get("title", "")): a for a in actual}

    for exp in expected:
        title = exp["title"]
        key = _norm_name(title)
        got = by_title.get(key)
        if got is None:
            errors.append(f"missing_title: {title}")
            continue

        if _norm_name(got.get("writer", "")) != _norm_name(exp["writer"]):
            errors.append(
                f"writer mismatch for '{title}': "
                f"expected '{exp['writer']}', got '{got.get('writer')}'"
            )

        if not _targets_match(exp["target"], got.get("target", "")):
            errors.append(
                f"target mismatch for '{title}': "
                f"expected '{exp['target']}', got '{got.get('target')}'"
            )

        content = got.get("content") or ""
        for needle in exp.get("content_contains") or []:
            if needle not in content:
                errors.append(f"content missing phrase for '{title}': {needle!r}")

    return errors


def run_offline_checks() -> list[str]:
    from article_extract import apply_review_heuristics

    errors: list[str] = []
    good = apply_review_heuristics(
        {
            "title": "AI교육 점심 메이트",
            "writer": "이소라",
            "target": "김강은, 이애희",
            "content": "안녕하세요. 고객지원팀 이소라입니다. " * 3,
            "needs_review": False,
            "review_reasons": [],
        }
    )
    if good["needs_review"]:
        errors.append(f"offline: good article flagged: {good['review_reasons']}")

    bad = apply_review_heuristics(
        {
            "title": "사랑의 챔피언",
            "writer": "",
            "target": "김강은 님",
            "content": "짧음",
            "needs_review": False,
            "review_reasons": [],
        }
    )
    for required in (
        "missing_writer",
        "short_content",
        "honorific_in_target",
        "section_header_as_title",
    ):
        if required not in bad["review_reasons"]:
            errors.append(f"offline: expected reason {required}")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Eval love-article extraction")
    parser.add_argument("--pdf", type=Path, default=None)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Only run local heuristic checks (no OpenAI call)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=PROJECT_ROOT / "output" / "eval_sample_result.json",
    )
    args = parser.parse_args(argv)

    expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
    errors = run_offline_checks()

    if args.offline:
        if errors:
            print("FAIL (offline)")
            for err in errors:
                print(" -", err)
            return 1
        print("PASS (offline heuristics)")
        return 0

    from article_extract import extract_articles_from_pdf

    pdf_path = resolve_pdf(args.pdf)
    print(f"Using PDF: {pdf_path}")
    result = extract_articles_from_pdf(str(pdf_path))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote prediction: {args.out}")

    errors.extend(score_articles(expected["articles"], result.get("articles") or []))

    if errors:
        print("FAIL")
        for err in errors:
            print(" -", err)
        return 1

    print("PASS")
    print(f"articles={len(result.get('articles') or [])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
