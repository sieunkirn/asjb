"""사람 손을 덜 타게 하는 옵션(자동 확정 · 검수 피드백 기억) 단위 시험 — DB 없이."""

from prompts.score_prompt import build_score_user_prompt
from services import feedback_memory, scoring_job


def _correction(**overrides):
    base = {
        "ai_type": "TYPE_4",
        "ai_score": 2.0,
        "human_score": 1.0,
        "summary": "박실천이 직접 만든 김밥을\n나눠 주었다",
        "names": ["박실천", "김작성"],
    }
    base.update(overrides)
    return base


def test_feedback_is_off_by_default(monkeypatch):
    monkeypatch.delenv("SCORING_USE_FEEDBACK", raising=False)
    assert feedback_memory.feedback_enabled() is False
    assert feedback_memory.get_feedback_block() == ""


def test_feedback_block_is_anonymized_and_one_line():
    block = feedback_memory.build_feedback_block([_correction()])
    assert "박실천" not in block  # 이름은 지운다
    assert "○○" in block
    assert "2 pt" in block and "1 pt" in block and "TYPE_4" in block
    # 요약 속 줄바꿈으로 프롬프트 구조를 흔들 수 없다 (사례 한 건 = 한 줄)
    example_lines = [ln for ln in block.splitlines() if ln.startswith("- AI judged")]
    assert len(example_lines) == 1
    assert "system prompt always take priority" in block  # 채점 규칙 우선


def test_feedback_summary_is_truncated_and_empty_is_skipped():
    long_one = _correction(summary="가" * 1000)
    block = feedback_memory.build_feedback_block([long_one, _correction(summary="")])
    lines = [ln for ln in block.splitlines() if ln.startswith("- AI judged")]
    assert len(lines) == 1
    assert len(lines[0]) < 400
    assert feedback_memory.build_feedback_block([]) == ""
    assert feedback_memory.build_feedback_block([_correction(summary="")]) == ""


def test_user_prompt_includes_feedback_only_when_given():
    article = {"article_id": 1, "content": "본문"}
    plain = build_score_user_prompt(article)
    with_fb = build_score_user_prompt(article, "FEEDBACK-BLOCK")
    assert "FEEDBACK-BLOCK" not in plain
    assert with_fb.startswith("FEEDBACK-BLOCK")
    assert with_fb.endswith(plain)  # 기존 프롬프트는 그대로 뒤에 붙는다


def test_feedback_failure_never_blocks_scoring(monkeypatch):
    monkeypatch.setenv("SCORING_USE_FEEDBACK", "1")
    monkeypatch.setitem(feedback_memory._cache, "at", 0.0)

    import db

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(db, "list_recent_corrections", boom)
    assert feedback_memory.get_feedback_block() == ""


def test_score_article_sends_feedback_block(monkeypatch):
    from services import scoring_service

    monkeypatch.setattr(scoring_service, "get_feedback_block", lambda: "FB-EXAMPLE")
    seen = {}

    def fake_llm(*, system_prompt, user_content, temperature):
        seen["user"] = user_content
        return {"practitioner_results": []}

    try:
        scoring_service.score_article(
            {"id": 1, "content": "본문입니다", "target": "박실천"}, llm_call=fake_llm
        )
    except Exception:
        pass  # 빈 결과는 검증에서 거절돼도 상관없다 — 프롬프트 전달만 확인
    assert "FB-EXAMPLE" in seen["user"]


def test_auto_confirm_flag_parsing(monkeypatch):
    for value, expected in [
        ("1", True),
        ("true", True),
        ("ON", True),
        ("", False),
        ("0", False),
        ("no", False),
    ]:
        monkeypatch.setenv("AUTO_CONFIRM_AFTER_SCORING", value)
        assert scoring_job._auto_confirm_enabled() is expected, value
    monkeypatch.delenv("AUTO_CONFIRM_AFTER_SCORING")
    assert scoring_job._auto_confirm_enabled() is False


def test_document_scoring_triggers_auto_confirm_only_when_enabled(monkeypatch):
    calls = []
    monkeypatch.setattr(scoring_job, "list_articles", lambda **k: [])
    monkeypatch.setattr(scoring_job, "get_client", lambda: object())
    monkeypatch.setattr(scoring_job, "_auto_confirm_document", lambda doc_id: calls.append(doc_id))

    monkeypatch.delenv("AUTO_CONFIRM_AFTER_SCORING", raising=False)
    scoring_job.process_document_scoring("doc-1")
    assert calls == []  # 기본은 꺼짐

    monkeypatch.setenv("AUTO_CONFIRM_AFTER_SCORING", "1")
    scoring_job.process_document_scoring("doc-2")
    assert calls == ["doc-2"]
