"""review_view 의 순수 계산(통계 · 검수 내용 · 호수 요약) 시험 — DB 없이."""

from datetime import UTC, datetime

from services.review_view import build_review_content, compute_stats, summarize_editions


def _row(
    id_, status="승인", dept="제빵팀", ai=2.0, final=None, flag=None, related=None, edition=956
):
    return {
        "id": id_,
        "edition": edition,
        "subject": f"이름{id_}",
        "department": dept,
        "aiScore": ai,
        "finalScore": final,
        "status": status,
        "flagReason": flag,
        "relatedArticleIds": related,
    }


def test_compute_stats_counts_and_averages_only_scored_rows():
    rows = [
        _row("1", ai=2.0, final=2.0),
        _row("2", ai=4.0),
        _row("3", status="중복 제외", ai=5.0),  # 평균에서 제외
        _row("4", status="재확인 필요", ai=0.0, flag="AI 채점 전 — 점수화 시작"),  # 평균에서 제외
        _row("5", status="재확인 필요", ai=0.0, flag="AI 채점 오류: x"),  # 평균에서 제외
    ]
    s = compute_stats(rows)
    assert (s["total"], s["approved"], s["pending"], s["excluded"]) == (5, 2, 2, 1)
    assert s["avgAiScore"] == 3.0  # (2 + 4) / 2
    assert s["avgFinalScore"] == 2.0  # 사람이 확정한 행만
    assert s["byDepartment"] == [{"department": "제빵팀", "count": 2, "avgScore": 3.0}]


def test_compute_stats_empty():
    s = compute_stats([])
    assert s["total"] == 0 and s["avgAiScore"] == 0 and s["avgFinalScore"] == 0
    assert s["byDepartment"] == [] and s["duplicatePairs"] == []


def test_compute_stats_duplicate_pairs_are_unique():
    rows = [_row("1", related=["2"]), _row("2", related=["1"])]
    assert len(compute_stats(rows)["duplicatePairs"]) == 1


def test_build_review_content():
    data = {
        "writer": "작성자",
        "target": "박실천",
        "title": "제목",
        "content": "본문",
        "rationale": "요약",
        "eval_status": "done",
        "article_review_reasons": [],
        "error_message": None,
        "raw_result": {
            "overall_confidence": "high",
            "practitioner_results": [
                {
                    "person_name": "박실천",
                    "practitioner_department": "제빵팀",
                    "score_type": "TYPE_4",
                    "auto_score_applied": True,
                    "score": 2,
                    "evidence": "근거",
                    "reason": "이유",
                }
            ],
        },
    }
    c = build_review_content(data)
    assert c["title"] == "제목" and c["confidence"] == 0.95
    assert "[실천 내용 요약] 요약" in c["body"] and "본문" in c["body"]
    labels = {r["label"]: r["value"] for r in c["recognized"]}
    assert labels["작성자"] == "작성자" and labels["부서"] == "박실천(제빵팀)"
    assert any("2점" in v for v in labels.values())


def test_build_review_content_defaults_and_error_flag():
    c = build_review_content({"eval_status": "error", "error_message": "boom", "raw_result": None})
    assert c["title"] == "(제목 없음)" and c["confidence"] == 0.7
    assert any("AI 채점 오류: boom" in f for f in c["flags"])


def test_summarize_editions_progress_and_month():
    rows = [
        _row("1", final=2.0),  # 확정
        _row("2", status="중복 제외"),  # 제외
        _row("3", status="재확인 필요", flag="AI 채점 오류: x"),
    ]
    docs = [
        {
            "original_filename": "신문_956호.pdf",
            "created_at": datetime(2026, 8, 31, 16, 0, tzinfo=UTC),
        },
        {"original_filename": "신문_957호.pdf", "created_at": datetime(2026, 9, 10, tzinfo=UTC)},
    ]
    meta = {957: {"edition_id": 957, "label": "특별호", "month": "10월"}}
    out = {e["id"]: e for e in summarize_editions(rows, docs, meta)}
    e956, e957 = out[956], out[957]
    assert e956["articleCount"] == 3 and e956["confirmed"] == 1 and e956["excluded"] == 1
    assert e956["errors"] == 1 and e956["progressPercent"] == 67 and e956["status"] == "검수 중"
    assert e956["month"] == "2026년 9월"  # UTC 8/31 16시 = 한국시간 9/1 → 9월
    assert e956["monthSource"] == "upload_date" and e956["sourceFile"] == "신문_956호.pdf"
    assert e957["label"] == "특별호" and e957["month"] == "10월" and e957["monthSource"] == "manual"
    assert e957["status"] == "업로드 대기" and e957["articleCount"] == 0
