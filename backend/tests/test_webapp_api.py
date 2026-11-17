"""webapp(화면용 DB API) 변환 로직 테스트 — DB 없이 순수 함수만 검증."""

from datetime import UTC

import pytest

from services.review_view import (
    InvalidArticleId,
    article_rows,
    attach_related,
    edition_from_filename,
    parse_public_id,
)


def _practitioner(**overrides):
    base = {
        "person_name": "박실천",
        "practitioner_department": "제빵팀",
        "score": 2,
        "score_type": "TYPE_4",
        "auto_score_applied": True,
        "candidate_score_if_confirmed": None,
        "needs_review": False,
        "review_reasons": [],
        "basis_item_or_action": "직접 만든 김밥 나눔",
        "evidence": "직접 만든 김밥을 나눠 주셨습니다",
    }
    base.update(overrides)
    return base


def _row(practitioners=None, **overrides):
    base = {
        "id": 42,
        "title": "제목",
        "writer": "김작성",
        "target": "박실천",
        "content": "본문" * 100,
        "article_needs_review": False,
        "article_review_reasons": [],
        "created_at": "2026-08-20T01:00:00+00:00",
        "document_id": "doc-uuid",
        "original_filename": "한가족신문_909호.pdf",
        "document_created_at": "2026-08-19T01:00:00+00:00",
        "eval_status": "done",
        "score": 2.0,
        "rationale": "실천 요약",
        "raw_result": {
            "evaluation_needs_review": False,
            "practitioner_results": practitioners
            if practitioners is not None
            else [_practitioner()],
        },
        "error_message": None,
        "evaluated_at": "2026-08-21T09:30:00+00:00",
    }
    base.update(overrides)
    return base


def test_parse_public_id():
    assert parse_public_id("1810") == (1810, None)
    assert parse_public_id("1810-2") == (1810, 2)
    with pytest.raises(InvalidArticleId):
        parse_public_id("abc")


def test_edition_from_filename():
    assert edition_from_filename("한가족신문_909호.pdf") == 909
    assert edition_from_filename("이름없음.pdf") == 0


def test_single_practitioner_keeps_plain_id():
    rows = article_rows(_row(), {})
    assert len(rows) == 1
    a = rows[0]
    assert a["id"] == "42"
    assert a["subject"] == "박실천"
    assert a["department"] == "제빵팀"
    assert a["status"] == "승인"
    assert a["aiScore"] == 2.0
    assert a["edition"] == 909
    assert a["basis"] == "직접 만든 김밥 나눔"


def test_multi_practitioners_split_into_rows():
    rows = article_rows(
        _row(
            practitioners=[
                _practitioner(),
                _practitioner(
                    person_name="이검토",
                    practitioner_department="",
                    score=None,
                    score_type="REVIEW_TYPE_1",
                    auto_score_applied=False,
                    candidate_score_if_confirmed=5,
                    needs_review=True,
                    review_reasons=["review_type_1_candidate"],
                    basis_item_or_action="",
                    evidence="갈등을 중재했습니다",
                ),
            ]
        ),
        {},
    )
    assert [r["id"] for r in rows] == ["42-1", "42-2"]
    first, second = rows
    assert first["subject"] == "박실천" and first["status"] == "승인" and first["aiScore"] == 2.0
    assert second["subject"] == "이검토" and second["status"] == "재확인 필요"
    assert second["aiScore"] == 0.0
    assert "1번 유형 후보" in second["flagReason"]
    assert "5점 후보" in second["flagReason"]
    assert second["department"] == "미기재"
    assert second["basis"] == "갈등을 중재했습니다"


def test_review_rows_override_per_practitioner():
    reviews = {
        (42, 2): {
            "review_status": "approved",
            "final_score": 4.0,
            "assignee": "웹 검수자",
            "excluded_with": None,
        },
    }
    rows = article_rows(
        _row(
            practitioners=[_practitioner(), _practitioner(person_name="이검토", needs_review=True)]
        ),
        reviews,
    )
    assert rows[0]["status"] == "승인" and rows[0]["finalScore"] is None
    assert rows[1]["status"] == "승인" and rows[1]["finalScore"] == 4.0
    assert rows[1]["assignee"] == "웹 검수자"


def test_unscored_and_error_stay_single_row():
    pending = article_rows(
        _row(eval_status=None, score=None, raw_result=None, evaluated_at=None), {}
    )
    assert len(pending) == 1
    assert pending[0]["id"] == "42"
    assert pending[0]["status"] == "재확인 필요"
    assert "채점 전" in pending[0]["flagReason"]
    assert pending[0]["date"] == "2026-08-20"

    error = article_rows(
        _row(eval_status="error", score=None, raw_result=None, error_message="boom"), {}
    )
    assert error[0]["status"] == "재확인 필요"
    assert "채점 오류" in error[0]["flagReason"]


def test_attach_related_links_split_rows():
    reviews = {
        (42, 0): {
            "review_status": "excluded",
            "final_score": None,
            "assignee": None,
            "excluded_with": 7,
        },
    }
    rows = article_rows(_row(), reviews)
    partner_rows = article_rows(
        _row(id=7, practitioners=[_practitioner(), _practitioner(person_name="둘째")]), {}
    )
    all_rows = rows + partner_rows
    attach_related(all_rows, reviews)
    assert all_rows[0]["status"] == "중복 제외"
    assert all_rows[0]["relatedArticleIds"] == ["7-1", "7-2"]
    assert all_rows[1]["relatedArticleIds"] == ["42"]
    assert all(("_base" not in r) for r in all_rows)


# ─── 확정 점수 검증 · 재채점 시 검수 결과 재연결 · 엑셀 반영 ────────────────────


def test_confirm_payload_rejects_scores_outside_allowed_set():
    from pydantic import ValidationError

    from api.routes.webapp import ConfirmPayload

    for good in (0, 1, 2, 4, 5):
        assert ConfirmPayload(finalScore=good).finalScore == float(good)
    for bad in (3, -1, 100, 2.5, 0.5):
        with pytest.raises(ValidationError):
            ConfirmPayload(finalScore=bad)


def test_review_follows_practitioner_name_after_rescore_reorder():
    # 재채점 후 순서가 박실천/김하나 → 김하나/박실천 으로 바뀐 경우
    # 박실천(2점 확정)의 점수가 김하나에게 붙으면 안 된다.
    row = _row(
        practitioners=[
            _practitioner(person_name="김하나"),
            _practitioner(person_name="박실천"),
        ]
    )
    reviews = {
        (42, 1): {
            "review_status": "approved",
            "final_score": 2.0,
            "assignee": "검수자",
            "excluded_with": None,
            "practitioner_name": "박실천",
        },
    }
    out = {r["subject"]: r for r in article_rows(row, reviews)}
    assert out["김하나"]["finalScore"] is None
    assert out["박실천"]["finalScore"] == 2.0


def test_review_without_stored_name_still_matches_by_index():
    # 이름 저장 기능 도입 전에 확정된 기존 데이터는 순번으로 계속 연결된다.
    row = _row(practitioners=[_practitioner(person_name="가"), _practitioner(person_name="나")])
    reviews = {
        (42, 2): {
            "review_status": "approved",
            "final_score": 1.0,
            "assignee": None,
            "excluded_with": None,
        },
    }
    out = {r["id"]: r for r in article_rows(row, reviews)}
    assert out["42-1"]["finalScore"] is None
    assert out["42-2"]["finalScore"] == 1.0


def test_excel_uses_human_confirmed_score_and_skips_excluded():
    from io import BytesIO

    from openpyxl import load_workbook

    from services.excel_export import evaluation_results_to_excel_bytes

    evaluations = [
        {
            "article_id": 42,
            "writer": "김작성",
            "target": "박실천",
            "status": "done",
            "practitioner_results": [
                _practitioner(
                    person_name="박실천",
                    score=None,
                    score_type="REVIEW_TYPE_1",
                    needs_review=True,
                    auto_score_applied=False,
                    candidate_score_if_confirmed=5,
                ),
            ],
        },
        {
            "article_id": 43,
            "writer": "이작성",
            "target": "최중복",
            "status": "done",
            "practitioner_results": [_practitioner(person_name="최중복", score=2)],
        },
    ]
    reviews = {
        (42, 0): {"review_status": "approved", "final_score": 5.0, "practitioner_name": None},
        (43, 0): {"review_status": "excluded", "final_score": None, "practitioner_name": None},
    }
    data = evaluation_results_to_excel_bytes(
        document={},
        summary={},
        evaluations=evaluations,
        reviews=reviews,
    )
    sheet = load_workbook(BytesIO(data)).active
    rows = [[c.value for c in r] for r in sheet.iter_rows(min_row=2)]
    names = [r[1] for r in rows]
    assert "박실천" in names
    assert "최중복" not in names  # 중복 제외는 내보내지 않음
    assert rows[names.index("박실천")][4] == 5  # 사람이 확정한 점수


def test_spa_fallback_blocks_path_traversal(tmp_path, monkeypatch):
    """/../backend/.env 같은 요청으로 dist 밖의 파일(.env 등)이 내려가면 안 된다."""
    import importlib

    from fastapi.testclient import TestClient

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "favicon.txt").write_text("fav", encoding="utf-8")
    (tmp_path / "secret.env").write_text("OPENAI_API_KEY=sk-secret", encoding="utf-8")

    monkeypatch.setenv("FRONTEND_DIST", str(dist))
    import api.app as app_module

    app_module = importlib.reload(app_module)
    client = TestClient(app_module.app)

    assert client.get("/favicon.txt").text == "fav"
    for attack in ("/../secret.env", "/..%2fsecret.env", "/%2e%2e/secret.env"):
        resp = client.get(attack)
        assert "sk-secret" not in resp.text, attack
    # 알 수 없는 /api 경로는 화면이 아니라 404
    assert client.get("/api/nope").status_code == 404

    monkeypatch.delenv("FRONTEND_DIST")
    importlib.reload(app_module)


# ─── 멈춘 작업 복구 · 일시 오류 처리 (DB 없이 검증) ───────────────────────────────


def test_extraction_transient_openai_errors_are_not_fatal():
    from services.extraction_job import _is_fatal_service_error

    class RateLimitError(Exception): ...

    class APITimeoutError(Exception): ...

    class APIConnectionError(Exception): ...

    class AuthenticationError(Exception): ...

    class OpenAIConfigError(Exception): ...

    # 한 페이지의 일시 오류는 문서 전체를 실패시키지 않는다
    for transient in (RateLimitError, APITimeoutError, APIConnectionError):
        assert _is_fatal_service_error(transient("x")) is False
    # 키/인증 문제는 모든 페이지에 영향 -> 즉시 중단
    for fatal in (AuthenticationError, OpenAIConfigError):
        assert _is_fatal_service_error(fatal("x")) is True


def test_extraction_all_pages_transient_failure_marks_document_failed(monkeypatch):
    from services import extraction_job

    statuses = []

    monkeypatch.setattr(
        extraction_job, "update_document_status", lambda *a, **k: statuses.append(k.get("status"))
    )
    monkeypatch.setattr(extraction_job, "update_document_progress", lambda *a, **k: None)
    monkeypatch.setattr(extraction_job, "upsert_articles_from_payload", lambda *a, **k: None)
    monkeypatch.setattr(extraction_job, "get_client", lambda: object())
    monkeypatch.setattr(extraction_job, "render_page_jpeg", lambda *a, **k: b"x")

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(extraction_job, "get_connection", lambda: _Conn())

    class RateLimitError(Exception): ...

    def boom(*a, **k):
        raise RateLimitError("429")

    monkeypatch.setattr(extraction_job, "extract_articles_from_page_image", boom)

    extraction_job.process_document(
        document_id="d",
        pdf_path="x.pdf",
        original_filename="a.pdf",
        page_indices=[0, 1],
    )
    assert statuses[-1] == "failed"  # 전부 실패 -> 재업로드 가능하도록 failed


def test_extraction_partial_transient_failure_keeps_document(monkeypatch):
    from services import extraction_job

    statuses = []
    monkeypatch.setattr(
        extraction_job, "update_document_status", lambda *a, **k: statuses.append(k.get("status"))
    )
    monkeypatch.setattr(extraction_job, "update_document_progress", lambda *a, **k: None)
    monkeypatch.setattr(extraction_job, "upsert_articles_from_payload", lambda *a, **k: None)
    monkeypatch.setattr(extraction_job, "get_client", lambda: object())
    monkeypatch.setattr(extraction_job, "render_page_jpeg", lambda *a, **k: b"x")

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(extraction_job, "get_connection", lambda: _Conn())

    class RateLimitError(Exception): ...

    def one_page_fails(jpeg, *, page_number, image_mime):
        if page_number == 1:
            raise RateLimitError("429")
        return [{"title": "t", "writer": "w", "target": "x", "content": "c"}]

    monkeypatch.setattr(extraction_job, "extract_articles_from_page_image", one_page_fails)

    extraction_job.process_document(
        document_id="d",
        pdf_path="x.pdf",
        original_filename="a.pdf",
        page_indices=[0, 1],
    )
    assert statuses[-1] == "completed_with_errors"  # 문서는 살리고 해당 페이지만 검토 필요


def test_scoring_skips_when_claim_not_granted(monkeypatch):
    """이미 진행 중이거나(중복 클릭) 완료된 기사는 GPT를 호출하지 않는다."""
    from services import scoring_job

    monkeypatch.setattr(scoring_job, "claim_evaluation_processing", lambda *a, **k: None)

    def must_not_call(*a, **k):
        raise AssertionError("score_article must not run without a claim")

    monkeypatch.setattr(scoring_job, "score_article", must_not_call)
    assert scoring_job._score_and_persist({"id": 1}, force=False) is False
    assert scoring_job._score_and_persist({"id": 1}, force=True) is False


# ─── 사소한 항목 수정: 한국 시간 · 엑셀 수식 · 프롬프트 ──────────────────────────


def test_date_str_uses_korean_time():
    from datetime import datetime

    from services.review_view import date_str as _date_str
    from services.review_view import to_kst as _to_kst

    # UTC 2026-08-31 16:30 = 한국 시간 2026-09-01 01:30 (새벽 작업이 전날로 보이던 문제)
    assert _date_str(datetime(2026, 8, 31, 16, 30, tzinfo=UTC)) == "2026-09-01"
    assert _date_str("2026-08-31T16:30:00+00:00") == "2026-09-01"
    assert _date_str("2026-08-31T16:30:00Z") == "2026-09-01"
    assert _date_str("2026-08-31T10:00:00+00:00") == "2026-08-31"
    assert _date_str(None) == ""
    assert _to_kst("not a date") is None
    assert _date_str("not a date") == "not a date"[:10]  # 해석 불가는 기존처럼 앞 10자


def test_excel_neutralizes_formula_like_text():
    from io import BytesIO

    from openpyxl import load_workbook

    from services.excel_export import evaluation_results_to_excel_bytes

    evil = '=HYPERLINK("http://evil.example","click")'
    evaluations = [
        {
            "article_id": 1,
            "writer": evil,
            "target": "박실천",
            "status": "done",
            "practitioner_results": [
                _practitioner(person_name="박실천", basis_item_or_action=evil)
            ],
        }
    ]
    data = evaluation_results_to_excel_bytes(document={}, summary={}, evaluations=evaluations)
    sheet = load_workbook(BytesIO(data)).active
    row = [c for c in next(sheet.iter_rows(min_row=2))]
    values = {c.value: c.data_type for c in row if isinstance(c.value, str)}
    assert evil in values
    assert values[evil] == "s"  # 수식('f')이 아니라 문자열


def test_score_prompt_lists_all_exclusion_rules():
    from prompts.score_prompt import SCORE_SYSTEM_PROMPT as prompt_text

    assert "EXCLUDED=EX-1..EX-7" in prompt_text
