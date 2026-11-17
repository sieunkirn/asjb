"""화면(대시보드 · 검수 · 호수)에 내려줄 데이터로 바꾸는 순수 변환 로직.

DB · HTTP를 전혀 모르는 함수들이라 단위 시험이 쉽다.
실천자가 여러 명인 기사는 실천자 한 명당 한 행으로 나눠 내려준다.
행 id는 실천자가 1명이면 "1810", 여러 명이면 "1810-1", "1810-2" 형식이다.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

REVIEW_STATUS_KO = {
    "approved": "승인",
    "pending": "재확인 필요",
    "excluded": "중복 제외",
}


REASON_KO = {
    "review_type_1_candidate": "1번 유형 후보 — 기업 검토 필요",
    "review_type_2_candidate": "2번 유형 후보 — 기업 검토 필요",
    "review_other_candidate": "기타내용 유형 후보 — 기업 검토 필요",
    "no_articles_extracted": "페이지에서 기사를 추출하지 못함",
    "missing_title": "제목 누락",
    "missing_writer": "작성자 누락",
    "missing_target": "실천자 누락",
    "missing_content": "본문 누락",
    "short_content": "본문이 너무 짧음",
    "honorific_in_target": "실천자에 호칭 포함",
    "section_header_as_title": "섹션 제목이 기사 제목으로 인식됨",
    "writer_score_not_automated": "작성자 점수 미자동화",
    "duplicate_check_unavailable": "회차 간 중복 확인 필요",
    "ambiguous_multiple_practitioners": "여러 실천자의 행동 귀속 불명확",
    "evidence_not_found_in_article": "원문 근거 재확인 필요",
    "duplicate_practitioner_results": "동일 실천자 결과 중복 가능성",
    "missing_or_invalid_rule_id_for_review_type": "적용 규칙 미지정 — 검토 시 확인 필요",
}


SCORE_TYPE_KO = {
    "TYPE_4": "4번 유형",
    "TYPE_5": "5번 유형",
    "EXCLUDED": "점수제외",
    "REVIEW_TYPE_1": "1번 유형 후보",
    "REVIEW_TYPE_2": "2번 유형 후보",
    "REVIEW_OTHER": "기타내용 유형 후보",
}


CONFIDENCE_NUMBER = {"high": 0.95, "medium": 0.8, "low": 0.6}


def reason_ko(code: Any) -> str:
    text = str(code or "")
    if text.startswith("extract_error:"):
        return f"추출 오류 ({text.split(':', 1)[1]})"
    return REASON_KO.get(text, text)


def edition_from_filename(name: str | None) -> int:
    match = re.search(r"(\d{3,4})\s*호", name or "")
    return int(match.group(1)) if match else 0


# DB(Render 등)의 시각은 UTC라서 그대로 자르면 한국 시간 새벽(0~9시) 작업이
# 전날 · 전월로 표시된다. 한국 시간(UTC+9)으로 바꿔서 날짜를 만든다.
KST = timezone(timedelta(hours=9))


def to_kst(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        dt = value
    elif value:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(KST)


def date_str(value: Any) -> str:
    dt = to_kst(value)
    if dt is not None:
        return dt.strftime("%Y-%m-%d")
    text = str(value or "")
    return text[:10] if text else ""


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def article_rows(
    row: dict[str, Any],
    reviews: dict[tuple[int, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    """DB 기사 1건 → 화면용 행 목록(실천자별 분리)."""
    aid = int(row["id"])
    raw = as_dict(row.get("raw_result"))
    practitioners = [p for p in as_list(raw.get("practitioner_results")) if isinstance(p, dict)]
    eval_status = row.get("eval_status")

    base_flags: list[str] = []
    if bool(row.get("article_needs_review")):
        reasons = ", ".join(reason_ko(c) for c in as_list(row.get("article_review_reasons")))
        if reasons:
            base_flags.append(f"추출 확인 필요: {reasons}")

    edition = edition_from_filename(row.get("original_filename"))
    author = str(row.get("writer") or "") or "-"
    date = date_str(row.get("evaluated_at") or row.get("created_at"))
    source_upload = str(row["document_id"]) if row.get("document_id") else None
    rationale = str(row.get("rationale") or "").strip()
    content_head = str(row.get("content") or "")[:160]

    def _norm(value: Any) -> str:
        return re.sub(r"\s+", "", str(value or ""))

    def review_for(idx: int, name: str) -> dict[str, Any] | None:
        """
        (기사, 실천자 순번)의 검수 결과를 찾는다.
        재채점으로 실천자 순서가 바뀌어도 저장된 실천자 이름이 다르면
        다른 사람의 점수를 붙이지 않고, 이름이 같은 검수 결과를 대신 찾는다.
        """
        review = reviews.get((aid, idx))
        if idx <= 0 or not name:
            return review
        if review is not None:
            stored = _norm(review.get("practitioner_name"))
            if not stored or stored == _norm(name):
                return review
        for (a, i), rv in reviews.items():
            if (
                a == aid
                and i > 0
                and _norm(rv.get("practitioner_name"))
                and _norm(rv.get("practitioner_name")) == _norm(name)
            ):
                return rv
        return None

    def build(
        public_id: str,
        idx: int,
        *,
        subject: str,
        department: str,
        ai_score: float,
        derived_status: str,
        flags: list[str],
        basis: str,
    ) -> dict[str, Any]:
        review = review_for(idx, subject)
        review_status = review.get("review_status") if review else None
        if review_status in REVIEW_STATUS_KO:
            status = REVIEW_STATUS_KO[str(review_status)]
        else:
            status = derived_status
        final_score = review.get("final_score") if review else None
        return {
            "id": public_id,
            "_base": aid,
            "edition": edition,
            "author": author,
            "subject": subject or "-",
            "department": department or "미기재",
            "aiScore": round(ai_score, 1),
            "finalScore": float(final_score) if final_score is not None else None,
            "status": status,
            "date": date,
            "flagReason": " · ".join(dict.fromkeys(f for f in flags if f)) or None,
            "basis": basis,
            "relatedArticleIds": None,
            "assignee": review.get("assignee") if review else None,
            "sourceUploadId": source_upload,
        }

    # 채점 완료 + 실천자 결과 있음 → 실천자별 1행
    if eval_status == "done" and practitioners:
        single = len(practitioners) == 1
        rows_out: list[dict[str, Any]] = []
        for i, p in enumerate(practitioners, start=1):
            idx = 0 if single else i
            public_id = str(aid) if single else f"{aid}-{i}"
            needs = bool(p.get("needs_review"))
            flags = [reason_ko(c) for c in as_list(p.get("review_reasons"))]
            candidate = p.get("candidate_score_if_confirmed")
            if needs and candidate is not None:
                flags.append(f"기업 확인 시 {candidate}점 후보")
            flags.extend(base_flags)
            score = p.get("score")
            basis = (
                str(p.get("basis_item_or_action") or "").strip()
                or str(p.get("evidence") or "").strip()
                or rationale
                or content_head
            )
            rows_out.append(
                build(
                    public_id,
                    idx,
                    subject=str(p.get("person_name") or "").strip(),
                    department=str(p.get("practitioner_department") or "").strip(),
                    ai_score=float(score) if score is not None else 0.0,
                    derived_status="재확인 필요" if needs else "승인",
                    flags=flags,
                    basis=basis,
                )
            )
        return rows_out

    # 채점 전 · 오류 · 실천자 결과 없음 → 기사 1행
    flags = list(base_flags)
    if eval_status == "error":
        derived = "재확인 필요"
        flags.insert(0, f"AI 채점 오류: {str(row.get('error_message') or '')[:120]}")
    elif eval_status == "done":
        derived = "승인"
    else:
        derived = "재확인 필요"
        flags.insert(0, "AI 채점 전 — 업로드 탭에서 ‘점수화 시작’을 실행해 주세요")

    return [
        build(
            str(aid),
            0,
            subject=str(row.get("target") or "").strip(),
            department="",
            ai_score=float(row["score"]) if row.get("score") is not None else 0.0,
            derived_status=derived,
            flags=flags,
            basis=rationale or content_head,
        )
    ]


def attach_related(
    rows_out: list[dict[str, Any]],
    reviews: dict[tuple[int, int], dict[str, Any]],
) -> None:
    """중복 제외 링크를 화면 행 id 기준으로 연결하고 내부 필드를 정리한다."""
    by_base: dict[int, list[str]] = {}
    for r in rows_out:
        by_base.setdefault(int(r["_base"]), []).append(str(r["id"]))

    partners: dict[int, set[int]] = {}
    for (aid, _idx), review in reviews.items():
        other = review.get("excluded_with")
        if other is None:
            continue
        partners.setdefault(aid, set()).add(int(other))
        partners.setdefault(int(other), set()).add(aid)

    for r in rows_out:
        base = int(r.pop("_base"))
        linked: list[str] = []
        for other in sorted(partners.get(base, ())):
            linked.extend(by_base.get(other, [str(other)]))
        r["relatedArticleIds"] = linked or None


class InvalidArticleId(ValueError):
    """화면용 id 형식("1810", "1810-2")이 아님."""


def parse_public_id(value: str) -> tuple[int, int | None]:
    """화면용 id("1810" 또는 "1810-2") → (기사 id, 실천자 순번)."""
    match = re.fullmatch(r"(\d+)(?:-(\d+))?", str(value or "").strip())
    if not match:
        raise InvalidArticleId(value)
    return int(match.group(1)), (int(match.group(2)) if match.group(2) else None)


def build_review_content(data: dict[str, Any]) -> dict[str, Any]:
    """기사 1건(ARTICLE_SQL 한 행) → 검수 화면의 본문 · 인식 결과 · 경고 목록."""
    raw = as_dict(data.get("raw_result"))
    practitioners = [p for p in as_list(raw.get("practitioner_results")) if isinstance(p, dict)]

    recognized = [
        {"label": "작성자", "value": str(data.get("writer") or "") or "-"},
        {"label": "실천자", "value": str(data.get("target") or "") or "-"},
    ]
    dept_parts: list[str] = []
    for p in practitioners:
        name = str(p.get("person_name") or "").strip()
        dept = str(p.get("practitioner_department") or "").strip()
        if dept:
            dept_parts.append(f"{name}({dept})" if name else dept)
        type_ko = SCORE_TYPE_KO.get(str(p.get("score_type") or ""), "")
        if name and type_ko:
            score = p.get("score")
            candidate = p.get("candidate_score_if_confirmed")
            if p.get("auto_score_applied") and score is not None:
                value = f"{type_ko} · {score}점"
            elif candidate is not None:
                value = f"{type_ko} · 검토 후 {candidate}점 후보"
            else:
                value = f"{type_ko} · 기업 검토"
            recognized.append({"label": name, "value": value})

    if dept_parts:
        recognized.append({"label": "부서", "value": ", ".join(dict.fromkeys(dept_parts))})

    flags: list[str] = []
    for code in as_list(raw.get("evaluation_review_reasons")):
        flags.append(reason_ko(code))
    for code in as_list(raw.get("quality_warnings")):
        flags.append(reason_ko(code))
    for code in as_list(data.get("article_review_reasons")):
        flags.append(reason_ko(code))
    if data.get("eval_status") == "error":
        flags.append(f"AI 채점 오류: {str(data.get('error_message') or '')[:120]}")

    content = str(data.get("content") or "")
    summary = str(data.get("rationale") or "").strip()
    evidences = "\n".join(
        f"· {p.get('person_name')}: “{p.get('evidence')}” — {p.get('reason')}"
        for p in practitioners
        if p.get("evidence")
    )
    body_parts = [part for part in [summary and f"[실천 내용 요약] {summary}", content] if part]

    return {
        "title": str(data.get("title") or "") or "(제목 없음)",
        "body": "\n\n".join(body_parts),
        "ocr": evidences or content,
        "recognized": recognized,
        "confidence": CONFIDENCE_NUMBER.get(str(raw.get("overall_confidence") or ""), 0.7),
        "flags": list(dict.fromkeys(f for f in flags if f)),
    }


def compute_stats(articles: list[dict[str, Any]]) -> dict[str, Any]:
    """화면용 기사 행 목록 → 대시보드 통계."""
    approved = [a for a in articles if a["status"] == "승인"]
    with_final = [a for a in approved if a.get("finalScore") is not None]

    # 평균에는 점수가 실제로 매겨진 행만 넣는다 (중복 제외 · 채점 전 · 채점 오류 제외)
    scored = [
        a
        for a in articles
        if a["status"] != "중복 제외"
        and "AI 채점 전" not in str(a.get("flagReason") or "")
        and "AI 채점 오류" not in str(a.get("flagReason") or "")
    ]

    departments: dict[str, dict[str, float]] = {}
    for a in scored:
        entry = departments.setdefault(a["department"], {"count": 0, "total": 0.0})
        entry["count"] += 1
        entry["total"] += float(
            a.get("finalScore") if a.get("finalScore") is not None else a["aiScore"]
        )

    seen: set[str] = set()
    duplicate_pairs = []
    for a in articles:
        for other in a.get("relatedArticleIds") or []:
            key = "|".join(sorted([a["id"], other]))
            if key not in seen:
                seen.add(key)
                duplicate_pairs.append({"ids": [a["id"], other], "subject": a["subject"]})

    return {
        "total": len(articles),
        "approved": len(approved),
        "pending": sum(1 for a in articles if a["status"] == "재확인 필요"),
        "excluded": sum(1 for a in articles if a["status"] == "중복 제외"),
        "avgAiScore": round(sum(a["aiScore"] for a in scored) / len(scored), 1) if scored else 0,
        "avgFinalScore": round(sum(float(a["finalScore"]) for a in with_final) / len(with_final), 1)
        if with_final
        else 0,
        "byDepartment": [
            {
                "department": dept,
                "count": int(v["count"]),
                "avgScore": round(v["total"] / v["count"], 1),
            }
            for dept, v in departments.items()
        ],
        "duplicatePairs": duplicate_pairs,
    }


def summarize_editions(
    articles: list[dict[str, Any]],
    docs: list[dict[str, Any]],
    meta: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """호수별 현황 요약. docs=최신 업로드 문서(created_at 오름차순), meta=호수 관리에서 저장한 값."""
    month_by_edition: dict[int, str] = {}
    file_by_edition: dict[int, str] = {}
    for doc in docs:
        number = edition_from_filename(doc["original_filename"])
        created = to_kst(doc["created_at"])
        if created is not None:
            month_by_edition.setdefault(number, f"{created.year}년 {created.month}월")
        # created_at 오름차순이므로 마지막 값 = 가장 최근 업로드 파일
        file_by_edition[number] = str(doc["original_filename"] or "")

    editions: dict[int, list[dict[str, Any]]] = {}
    for article in articles:
        editions.setdefault(int(article["edition"]), []).append(article)
    for number in month_by_edition:
        editions.setdefault(number, [])

    result = []
    for number in sorted(editions, reverse=True):
        group = editions[number]
        total = len(group)
        pending = sum(1 for a in group if a["status"] == "재확인 필요")
        excluded = sum(1 for a in group if a["status"] == "중복 제외")
        confirmed = sum(
            1 for a in group if a["status"] == "승인" and a.get("finalScore") is not None
        )
        flags = [str(a.get("flagReason") or "") for a in group]
        errors = sum(1 for f in flags if "AI 채점 오류" in f)
        unscored = sum(1 for f in flags if "AI 채점 전" in f)
        # 검수 진행률 = (사람이 확정한 승인 + 중복 제외) / 전체
        progress = round((confirmed + excluded) / total * 100) if total else 0
        if not group:
            status = "업로드 대기"
        elif progress == 100:
            status = "완료"
        else:
            status = "검수 중"
        m = meta.get(number) or {}
        manual_month = str(m.get("month") or "").strip()
        result.append(
            {
                "id": number,
                "label": str(m.get("label") or "").strip()
                or (f"{number}호" if number else "호수 미지정"),
                "month": manual_month or month_by_edition.get(number, ""),
                "monthSource": "manual" if manual_month else "upload_date",
                "sourceFile": file_by_edition.get(number),
                "status": status,
                "articleCount": total,
                "pending": pending,
                "confirmed": confirmed,
                "excluded": excluded,
                "errors": errors,
                "unscored": unscored,
                "progressPercent": progress,
            }
        )
    return result
