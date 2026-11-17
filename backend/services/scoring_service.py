"""Score one extracted love article and validate the LLM result.

Important separation:
- articles.needs_review is a technical extraction flag.
- evaluation_needs_review is an HR/business flag and is true only for
  Type 1, Type 2, and Other-content candidates.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from prompts.score_prompt import (
    SCORE_PROMPT_VERSION,
    SCORE_SYSTEM_PROMPT,
    build_score_user_prompt,
)
from services.feedback_memory import get_feedback_block
from services.openai_client import call_llm_json


class ScoringInputError(ValueError):
    """Raised when an article does not contain enough data to score."""


class ScoringValidationError(ValueError):
    """Raised when the LLM result violates the scoring contract."""


AUTO_TYPES: dict[str, dict[str, Any]] = {
    "TYPE_4": {
        "score": 2,
        "decision": "AUTO_SCORE",
        "rule_ids": {
            "T4-1",
            "T4-2",
            "T4-3",
            "T4-3-COUPLE",
            "T4-4",
            "T4-5",
        },
    },
    "TYPE_5": {
        "score": 1,
        "decision": "AUTO_SCORE",
        "rule_ids": {
            "T5-2",
            "T5-3",
            "T5-4",
            "T5-5",
            "T5-6",
        },
    },
    "EXCLUDED": {
        "score": 0,
        "decision": "AUTO_SCORE",
        "rule_ids": {
            "EX-1",
            "EX-2",
            "EX-3",
            "EX-4",
            "EX-5",
            "EX-6",
            "EX-7",
        },
    },
}


REVIEW_TYPES: dict[str, dict[str, Any]] = {
    "REVIEW_TYPE_1": {
        "score": None,
        "decision": "BUSINESS_REVIEW",
        "candidate_score": 5,
        "review_reason": "review_type_1_candidate",
        "rule_ids": {
            "R1-1",
            "R1-2",
        },
    },
    "REVIEW_TYPE_2": {
        "score": None,
        "decision": "BUSINESS_REVIEW",
        "candidate_score": 4,
        "review_reason": "review_type_2_candidate",
        "rule_ids": {
            "R2-1",
            "R2-2",
        },
    },
    "REVIEW_OTHER": {
        "score": None,
        "decision": "BUSINESS_REVIEW",
        "candidate_score": None,
        "review_reason": "review_other_candidate",
        "rule_ids": {
            "RO-1",
            "RO-2",
            "RO-3",
        },
    },
}


ALLOWED_BASIS_KINDS = {
    "GIFT",
    "ACTION",
    "MEAL",
    "CARPOOL",
    "SHARING",
    "CUSTOMER_PRAISE",
    "OTHER",
}


ALLOWED_CONFIDENCE = {
    "high",
    "medium",
    "low",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, list):
        return [text for item in value if (text := _text(item))]

    text = _text(value)

    return [text] if text else []


def _normalize_for_match(
    value: str,
) -> str:
    """
    기사 원문과 GPT 근거 문장을 비교하기 위해
    공백과 따옴표를 정규화한다.
    """

    value = value.replace("“", '"')
    value = value.replace("”", '"')
    value = value.replace("‘", "'")
    value = value.replace("’", "'")

    return re.sub(
        r"\s+",
        "",
        value,
    )


def _evidence_is_in_content(
    evidence: str,
    content: str,
) -> bool:
    if not evidence or not content:
        return False

    return _normalize_for_match(evidence) in _normalize_for_match(content)


def _normalize_result(
    raw: dict[str, Any],
    *,
    article_content: str,
) -> tuple[dict[str, Any], list[str]]:
    """
    GPT가 출력한 점수와 검토 여부를 그대로 믿지 않고
    score_type에 따라 백엔드에서 다시 결정한다.
    """

    score_type = _text(raw.get("score_type"))

    rule_id = _text(raw.get("rule_id"))

    warnings: list[str] = []

    if score_type in AUTO_TYPES:
        contract = AUTO_TYPES[score_type]

        score = int(contract["score"])

        decision = str(contract["decision"])

        candidate_score = None
        needs_review = False
        review_reasons: list[str] = []
        auto_score_applied = True

        allowed_rule_ids = set(contract["rule_ids"])

    elif score_type in REVIEW_TYPES:
        contract = REVIEW_TYPES[score_type]

        score = None

        decision = str(contract["decision"])

        candidate_score = contract["candidate_score"]

        needs_review = True

        review_reasons = [str(contract["review_reason"])]

        auto_score_applied = False

        allowed_rule_ids = set(contract["rule_ids"])

    else:
        raise ScoringValidationError(f"Unsupported score_type: {score_type!r}")

    if rule_id not in allowed_rule_ids:
        if score_type in REVIEW_TYPES:
            # 검토 유형은 점수를 자동 확정하지 않으므로, GPT가 rule_id를
            # 빠뜨려도 평가 전체를 오류로 버리지 않고 기업 검토 대상으로
            # 살려 둔다. (경고를 남겨 검토자가 확인하게 한다)
            warnings.append("missing_or_invalid_rule_id_for_review_type")
            rule_id = ""
        else:
            # 자동 확정 점수는 규칙에 따라 점수가 달라지므로(T4-3-COUPLE 등)
            # 잘못된 rule_id를 그대로 쓸 수 없다.
            raise ScoringValidationError(f"Rule {rule_id!r} is not valid for {score_type}.")

    # 사내부부가 집 초대에 공동 참여한 경우
    # 4번 유형이지만 각 1점씩 적용한다.
    if score_type == "TYPE_4" and rule_id == "T4-3-COUPLE":
        score = 1

    person_name = _text(raw.get("person_name"))

    if not person_name:
        raise ScoringValidationError("Practitioner result is missing person_name.")

    evidence = _text(raw.get("evidence"))

    if not evidence:
        raise ScoringValidationError(f"Practitioner {person_name!r} is missing evidence.")

    if not _evidence_is_in_content(
        evidence,
        article_content,
    ):
        warnings.append("evidence_not_found_in_article")

    reason = _text(raw.get("reason"))

    if not reason:
        raise ScoringValidationError(f"Practitioner {person_name!r} is missing reason.")

    basis_kind = _text(raw.get("basis_kind")) or "OTHER"

    if basis_kind not in ALLOWED_BASIS_KINDS:
        basis_kind = "OTHER"

        warnings.append("unsupported_basis_kind_replaced")

    confidence = _text(raw.get("confidence")).lower() or "low"

    if confidence not in ALLOWED_CONFIDENCE:
        confidence = "low"

        warnings.append("unsupported_confidence_replaced")

    normalized = {
        "person_name": person_name,
        "practitioner_department": _text(raw.get("practitioner_department")),
        "person_role": "practitioner",
        "decision": decision,
        "score": score,
        "score_type": score_type,
        "rule_id": rule_id,
        "score_label": _text(raw.get("score_label")),
        "basis_kind": basis_kind,
        "basis_item_or_action": _text(raw.get("basis_item_or_action")),
        "auto_score_applied": auto_score_applied,
        "candidate_score_if_confirmed": candidate_score,
        "matched_rule": _text(raw.get("matched_rule")),
        "evidence": evidence,
        "reason": reason,
        "needs_review": needs_review,
        "review_reasons": review_reasons,
        "decision_codes": _string_list(raw.get("decision_codes")),
        "confidence": confidence,
    }

    return normalized, warnings


def score_article(
    article: dict[str, Any],
    *,
    llm_call: Callable[
        ...,
        dict[str, Any],
    ] = call_llm_json,
) -> dict[str, Any]:
    """
    DB에서 불러온 기사 한 편의 실천자 점수를 계산한다.
    """

    content = _text(article.get("content"))

    target = _text(article.get("target"))

    if not content:
        raise ScoringInputError("Article content is empty.")

    if not target:
        raise ScoringInputError("Article target is empty.")

    article_input = {
        "article_id": article.get("id"),
        "source_page": article.get("source_page"),
        "title": _text(article.get("title")),
        "writer": _text(article.get("writer")),
        "target": target,
        "content": content,
        # 기사 추출 단계의 기술적 검토 정보다.
        # 평가 검토 정보로 복사하면 안 된다.
        "article_needs_review": bool(article.get("needs_review")),
        "article_review_reasons": _string_list(article.get("review_reasons")),
    }

    raw = llm_call(
        system_prompt=SCORE_SYSTEM_PROMPT,
        user_content=build_score_user_prompt(
            article_input,
            get_feedback_block(),
        ),
        temperature=0.0,
    )

    raw_results = raw.get("practitioner_results")

    if not isinstance(
        raw_results,
        list,
    ):
        raise ScoringValidationError("practitioner_results must be a list.")

    if not raw_results:
        raise ScoringValidationError("At least one practitioner result is required.")

    practitioner_results: list[dict[str, Any]] = []

    backend_warnings: list[str] = []

    for raw_result in raw_results:
        if not isinstance(
            raw_result,
            dict,
        ):
            raise ScoringValidationError("Each practitioner result must be an object.")

        normalized, warnings = _normalize_result(
            raw_result,
            article_content=content,
        )

        practitioner_results.append(normalized)

        backend_warnings.extend(warnings)

    normalized_names = [
        re.sub(
            r"\s+",
            "",
            item["person_name"],
        )
        for item in practitioner_results
    ]

    if len(normalized_names) != len(set(normalized_names)):
        backend_warnings.append("duplicate_practitioner_results")

    review_reasons: list[str] = []

    for result in practitioner_results:
        for reason in result["review_reasons"]:
            if reason not in review_reasons:
                review_reasons.append(reason)

    quality_warnings: list[str] = []

    for warning in [
        # 작성자 점수는 이번 버전에서
        # 자동 계산하지 않는다.
        "writer_score_not_automated",
        *_string_list(raw.get("quality_warnings")),
        *backend_warnings,
    ]:
        if warning and warning not in quality_warnings:
            quality_warnings.append(warning)

    auto_score_total = sum(
        int(result["score"])
        for result in practitioner_results
        if (result["auto_score_applied"] and result["score"] is not None)
    )

    overall_confidence = _text(raw.get("overall_confidence")).lower()

    if overall_confidence not in ALLOWED_CONFIDENCE:
        overall_confidence = "low"

        quality_warnings.append("unsupported_overall_confidence_replaced")

    # 반드시 백엔드에서 다시 계산한다.
    evaluation_needs_review = bool(review_reasons)

    return {
        "prompt_version": SCORE_PROMPT_VERSION,
        "article_id": article.get("id"),
        "document_id": article.get("document_id"),
        "source_page": article.get("source_page"),
        "title": _text(article.get("title")),
        "writer": _text(article.get("writer")),
        "target": target,
        "article_action_summary": _text(raw.get("article_action_summary")),
        "writer_scoring": {
            "status": "NOT_AUTOMATED",
            "score": None,
            "reason": (
                "현재 기사 추출 JSON에는 "
                "작성자 부서와 신문 지면 기준 "
                "줄 수가 없어 작성자 점수를 "
                "자동 확정하지 않습니다."
            ),
        },
        "auto_score_total": auto_score_total,
        "evaluation_needs_review": evaluation_needs_review,
        "evaluation_review_reasons": review_reasons,
        "quality_warnings": quality_warnings,
        "practitioner_results": practitioner_results,
        "validation": {
            "allowed_score_values_only": all(
                item["score"]
                in {
                    None,
                    0,
                    1,
                    2,
                }
                for item in practitioner_results
            ),
            "business_review_only_for_1_2_other": all(
                not item["needs_review"]
                or item["score_type"]
                in {
                    "REVIEW_TYPE_1",
                    "REVIEW_TYPE_2",
                    "REVIEW_OTHER",
                }
                for item in practitioner_results
            ),
            "review_flag_consistent": (
                evaluation_needs_review
                == any(item["needs_review"] for item in practitioner_results)
            ),
            "all_results_have_evidence": all(
                bool(item["evidence"]) for item in practitioner_results
            ),
        },
        "overall_confidence": overall_confidence,
    }
