import { describe, expect, it } from "vitest";
import type { ArticleEvaluation, PractitionerResult } from "../api/scoring";
import {
  extractionStatusLabel,
  isExtractionFinished,
  isExtractionReadyForScoring,
  isEvaluationFinished,
  practitionerScoreText,
  reviewReasonLabel,
  scoreTypeLabel,
  summarizeEvaluations,
  warningLabel,
} from "./scoringLabels";

function practitioner(overrides: Partial<PractitionerResult>): PractitionerResult {
  return {
    person_name: "홍길동",
    practitioner_department: "",
    person_role: "practitioner",
    decision: "AUTO_SCORE",
    score: 2,
    score_type: "TYPE_4",
    rule_id: "T4-1",
    score_label: "",
    basis_kind: "GIFT",
    basis_item_or_action: "",
    auto_score_applied: true,
    candidate_score_if_confirmed: null,
    matched_rule: "",
    evidence: "근거",
    reason: "사유",
    needs_review: false,
    review_reasons: [],
    decision_codes: [],
    confidence: "high",
    ...overrides,
  };
}

function evaluation(overrides: Partial<ArticleEvaluation>): ArticleEvaluation {
  return {
    article_id: 1,
    document_id: "doc",
    source_page: 1,
    title: "",
    writer: "",
    target: "",
    article_needs_review: false,
    article_review_reasons: [],
    evaluation_id: 1,
    status: "done",
    score: 0,
    grade: null,
    rationale: null,
    model: null,
    raw_result: null,
    error_message: null,
    evaluated_at: null,
    created_at: null,
    updated_at: null,
    evaluation_needs_review: false,
    evaluation_review_reasons: [],
    quality_warnings: [],
    practitioner_results: [],
    ...overrides,
  };
}

describe("scoringLabels", () => {
  it("추출 상태 라벨과 완료 판정", () => {
    expect(extractionStatusLabel("processing")).toBe("기사 추출 중");
    expect(extractionStatusLabel("unknown_status")).toBe("unknown_status");
    expect(isExtractionFinished("completed_with_errors")).toBe(true);
    expect(isExtractionFinished("queued")).toBe(false);
    expect(isExtractionReadyForScoring("failed")).toBe(false);
    expect(isExtractionReadyForScoring("completed")).toBe(true);
  });

  it("점수화 완료 판정", () => {
    expect(isEvaluationFinished("completed")).toBe(true);
    expect(isEvaluationFinished("processing")).toBe(false);
  });

  it("점수 유형 · 검토 사유 · 경고 라벨", () => {
    expect(scoreTypeLabel("REVIEW_TYPE_1")).toBe("1번 유형 후보");
    expect(scoreTypeLabel("EXCLUDED")).toBe("점수제외");
    expect(reviewReasonLabel("review_type_2_candidate")).toBe("2번 유형 후보");
    expect(reviewReasonLabel("extract_error:TimeoutError")).toBe("추출 오류 (TimeoutError)");
    expect(reviewReasonLabel("something_else")).toBe("something_else");
    expect(warningLabel("evidence_not_found_in_article")).toBe("원문 근거 재확인 필요");
  });

  it("실천자 점수 표시 문자열", () => {
    expect(practitionerScoreText(practitioner({}))).toBe("2점");
    expect(practitionerScoreText(practitioner({
      auto_score_applied: false, score: null, score_type: "REVIEW_TYPE_1",
      candidate_score_if_confirmed: 5, needs_review: true,
    }))).toBe("검토 후 5점 후보");
    expect(practitionerScoreText(practitioner({
      auto_score_applied: false, score: null, score_type: "REVIEW_OTHER",
      candidate_score_if_confirmed: null, needs_review: true,
    }))).toBe("기업 검토");
  });

  it("평가 결과 집계 — done 상태만 포함", () => {
    const list = [
      evaluation({ practitioner_results: [practitioner({}), practitioner({ score: 1, score_type: "TYPE_5" })] }),
      evaluation({
        article_id: 2,
        practitioner_results: [practitioner({
          auto_score_applied: false, score: null, needs_review: true, candidate_score_if_confirmed: 4,
        })],
      }),
      evaluation({ article_id: 3, status: "error", practitioner_results: [practitioner({})] }),
    ];
    expect(summarizeEvaluations(list)).toEqual({
      autoScoreTotal: 3,
      practitionerCount: 3,
      reviewPractitionerCount: 1,
    });
  });
});
