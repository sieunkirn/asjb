"""scoring_service 검증 규칙 테스트 (rule_id 처리)."""

import pytest

from services.scoring_service import ScoringValidationError, score_article

ARTICLE = {
    "id": 1,
    "document_id": None,
    "source_page": 5,
    "title": "제목",
    "writer": "김작성",
    "target": "박실천",
    "content": "박실천 님이 갈등을 중재해 관계를 회복시켰습니다.",
    "needs_review": False,
    "review_reasons": [],
}


def _llm(practitioner: dict):
    def fake_llm_call(**_kwargs):
        return {
            "article_action_summary": "요약",
            "quality_warnings": [],
            "overall_confidence": "high",
            "practitioner_results": [practitioner],
        }

    return fake_llm_call


def _practitioner(**overrides):
    base = {
        "person_name": "박실천",
        "practitioner_department": "",
        "decision": "BUSINESS_REVIEW",
        "score": None,
        "score_type": "REVIEW_TYPE_1",
        "rule_id": "",
        "score_label": "",
        "basis_kind": "OTHER",
        "basis_item_or_action": "",
        "candidate_score_if_confirmed": 5,
        "matched_rule": "",
        "evidence": "갈등을 중재해 관계를 회복시켰습니다",
        "reason": "조직 갈등 중재 사례",
        "needs_review": True,
        "review_reasons": ["review_type_1_candidate"],
        "decision_codes": [],
        "confidence": "high",
    }
    base.update(overrides)
    return base


def test_review_type_with_missing_rule_id_is_repaired_not_failed():
    result = score_article(ARTICLE, llm_call=_llm(_practitioner(rule_id="")))

    assert result["evaluation_needs_review"] is True
    item = result["practitioner_results"][0]
    assert item["score_type"] == "REVIEW_TYPE_1"
    assert item["rule_id"] == ""
    assert item["needs_review"] is True
    assert item["candidate_score_if_confirmed"] == 5
    assert "missing_or_invalid_rule_id_for_review_type" in result["quality_warnings"]


def test_review_type_with_valid_rule_id_has_no_warning():
    result = score_article(ARTICLE, llm_call=_llm(_practitioner(rule_id="R1-2")))

    assert result["practitioner_results"][0]["rule_id"] == "R1-2"
    assert "missing_or_invalid_rule_id_for_review_type" not in result["quality_warnings"]


def test_auto_score_with_invalid_rule_id_still_fails():
    bad = _practitioner(
        decision="AUTO_SCORE",
        score=2,
        score_type="TYPE_4",
        rule_id="",
        candidate_score_if_confirmed=None,
        needs_review=False,
        review_reasons=[],
    )
    with pytest.raises(ScoringValidationError):
        score_article(ARTICLE, llm_call=_llm(bad))
