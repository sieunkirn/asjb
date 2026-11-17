/**
 * 사랑기사 분석·채점 백엔드가 돌려주는 코드값 → 화면용 한글 라벨
 * (백엔드 demo.html · scoring_service.py · article_extract.py 기준)
 */
import type {
  ArticleEvaluation,
  EvaluationStatus,
  EvaluationSummaryStatus,
  ExtractionStatus,
  PractitionerResult,
  ScoreType,
} from "../api/scoring";

// ─── 기사 추출(document) 상태 ────────────────────────────────────────────────

export const EXTRACTION_STATUS_LABELS: Record<ExtractionStatus, string> = {
  queued: "대기 중",
  processing: "기사 추출 중",
  completed: "추출 완료",
  completed_with_errors: "추출 완료 (확인 필요 페이지 있음)",
  failed: "추출 실패",
};

export function extractionStatusLabel(status: string | null | undefined): string {
  return EXTRACTION_STATUS_LABELS[status as ExtractionStatus] ?? (status || "-");
}

export function isExtractionFinished(status: string | null | undefined): boolean {
  return status === "completed" || status === "completed_with_errors" || status === "failed";
}

/** 점수화를 시작할 수 있는 추출 상태인지 (백엔드 EXTRACTION_READY_STATUSES) */
export function isExtractionReadyForScoring(status: string | null | undefined): boolean {
  return status === "completed" || status === "completed_with_errors";
}

// ─── 점수화(evaluation) 상태 ─────────────────────────────────────────────────

export const EVALUATION_SUMMARY_STATUS_LABELS: Record<EvaluationSummaryStatus, string> = {
  not_ready: "기사 없음",
  pending: "점수화 전",
  processing: "점수화 진행 중",
  completed: "점수화 완료",
  completed_with_errors: "점수화 완료 (오류 기사 있음)",
};

export function evaluationSummaryStatusLabel(status: string | null | undefined): string {
  return EVALUATION_SUMMARY_STATUS_LABELS[status as EvaluationSummaryStatus] ?? (status || "-");
}

export function isEvaluationFinished(status: string | null | undefined): boolean {
  return status === "completed" || status === "completed_with_errors";
}

export const EVALUATION_STATUS_LABELS: Record<EvaluationStatus, string> = {
  pending: "대기",
  processing: "채점 중",
  done: "완료",
  error: "오류",
};

export function evaluationStatusLabel(status: string | null | undefined): string {
  return EVALUATION_STATUS_LABELS[status as EvaluationStatus] ?? (status || "-");
}

// ─── 점수 유형 ───────────────────────────────────────────────────────────────

export const SCORE_TYPE_LABELS: Record<ScoreType, string> = {
  TYPE_4: "4번 유형",
  TYPE_5: "5번 유형",
  EXCLUDED: "점수제외",
  REVIEW_TYPE_1: "1번 유형 후보",
  REVIEW_TYPE_2: "2번 유형 후보",
  REVIEW_OTHER: "기타내용 유형 후보",
};

export function scoreTypeLabel(value: string | null | undefined): string {
  return SCORE_TYPE_LABELS[value as ScoreType] ?? (value || "");
}

/** 자동 확정 점수 또는 "검토 후 N점 후보" 형태의 표시 문자열 */
export function practitionerScoreText(result: PractitionerResult): string {
  if (result.auto_score_applied && result.score != null) {
    return `${result.score}점`;
  }
  if (result.candidate_score_if_confirmed != null) {
    return `검토 후 ${result.candidate_score_if_confirmed}점 후보`;
  }
  return "기업 검토";
}

// ─── 검토 사유 · 경고 ────────────────────────────────────────────────────────

const REVIEW_REASON_LABELS: Record<string, string> = {
  // 사랑평가(기업 검토) 사유
  review_type_1_candidate: "1번 유형 후보",
  review_type_2_candidate: "2번 유형 후보",
  review_other_candidate: "기타내용 유형 후보",
  // 기사 추출(기술 확인) 사유
  no_articles_extracted: "페이지에서 기사를 추출하지 못함",
  missing_title: "제목 누락",
  missing_writer: "작성자 누락",
  missing_target: "실천자 누락",
  missing_content: "본문 누락",
  short_content: "본문이 너무 짧음",
  honorific_in_target: "실천자에 호칭 포함",
  section_header_as_title: "섹션 제목이 기사 제목으로 인식됨",
};

export function reviewReasonLabel(value: string): string {
  if (REVIEW_REASON_LABELS[value]) return REVIEW_REASON_LABELS[value];
  if (value.startsWith("extract_error:")) {
    return `추출 오류 (${value.slice("extract_error:".length)})`;
  }
  return value;
}

const WARNING_LABELS: Record<string, string> = {
  writer_score_not_automated: "작성자 점수 미자동화",
  duplicate_check_unavailable: "회차 간 중복 확인 필요",
  ambiguous_multiple_practitioners: "여러 실천자의 행동 귀속 불명확",
  evidence_not_found_in_article: "원문 근거 재확인 필요",
  duplicate_practitioner_results: "동일 실천자 결과 중복 가능성",
  unsupported_basis_kind_replaced: "근거 종류 값 보정됨",
  missing_or_invalid_rule_id_for_review_type: "적용 규칙(rule_id) 미지정 — 검토 시 확인 필요",
  unsupported_confidence_replaced: "신뢰도 값 보정됨",
  unsupported_overall_confidence_replaced: "전체 신뢰도 값 보정됨",
};

export function warningLabel(value: string): string {
  return WARNING_LABELS[value] ?? value;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export function confidenceLabel(value: string | null | undefined): string {
  return CONFIDENCE_LABELS[value ?? ""] ?? (value || "-");
}

// ─── 집계 ────────────────────────────────────────────────────────────────────

/** 평가 결과 목록에서 자동 확정 점수 합계 · 기업 검토 실천자 수 */
export function summarizeEvaluations(evaluations: ArticleEvaluation[]): {
  autoScoreTotal: number;
  practitionerCount: number;
  reviewPractitionerCount: number;
} {
  let autoScoreTotal = 0;
  let practitionerCount = 0;
  let reviewPractitionerCount = 0;
  for (const ev of evaluations) {
    if (ev.status !== "done") continue;
    for (const r of ev.practitioner_results ?? []) {
      practitionerCount += 1;
      if (r.auto_score_applied && r.score != null) autoScoreTotal += r.score;
      if (r.needs_review) reviewPractitionerCount += 1;
    }
  }
  return { autoScoreTotal, practitionerCount, reviewPractitionerCount };
}

/** 브라우저 저장용 문서 ID 키 (새로고침해도 마지막 문서를 유지) */
export const SCORING_LAST_DOCUMENT_KEY = "bredred-scoring-last-document-v1";
