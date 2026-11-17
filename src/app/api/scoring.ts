/**
 * 사랑기사 분석·채점 백엔드(SSD_Scoring, FastAPI) API 클라이언트
 * ─────────────────────────────────────────────────────────────────────
 * 백엔드 팀이 만든 서버(`python -m uvicorn api.app:app --port 8000`)의
 * `/api/v1/*` 엔드포인트를 호출합니다.
 *
 * - 개발 모드: Vite 프록시(`/api/v1` → http://127.0.0.1:8000)를 타므로 별도 설정 불필요
 * - 배포 모드: `VITE_SCORING_API_BASE_URL=https://백엔드주소` 설정
 *
 * 기존 Mock ↔ 실API 스위치(client.ts)와는 독립적으로 동작합니다.
 * (이 기능은 Mock이 없고 항상 실제 백엔드를 호출합니다.)
 */

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type ExtractionStatus =
  | "queued"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed";

/** GET /api/v1/documents/{id} · POST /api/v1/documents 응답 */
export interface ScoringDocument {
  document_id: string;
  original_filename: string;
  file_size_bytes: number;
  total_pages: number;
  love_page_numbers: number[];
  status: ExtractionStatus;
  processed_pages: number;
  total_love_pages: number;
  article_count: number;
  error_message: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
  progress_percent: number;
  is_finished: boolean;
}

/** GET /api/v1/documents/{id}/articles 의 articles[] 항목 */
export interface ExtractedArticle {
  id: number;
  document_id: string;
  source_page: number | null;
  title: string;
  writer: string;
  target: string;
  content: string;
  needs_review: boolean;
  review_reasons: string[];
  created_at: string;
  updated_at: string;
}

export interface ExtractedArticlesResponse {
  document_id: string;
  status: ExtractionStatus;
  article_count: number;
  articles: ExtractedArticle[];
}

export type ScoreType =
  | "TYPE_4"
  | "TYPE_5"
  | "EXCLUDED"
  | "REVIEW_TYPE_1"
  | "REVIEW_TYPE_2"
  | "REVIEW_OTHER";

export type Confidence = "high" | "medium" | "low";

/** raw_result.practitioner_results[] — 실천자 한 명의 점수 결과 */
export interface PractitionerResult {
  person_name: string;
  practitioner_department: string;
  person_role: "practitioner";
  decision: "AUTO_SCORE" | "BUSINESS_REVIEW";
  score: number | null;
  score_type: ScoreType;
  rule_id: string;
  score_label: string;
  basis_kind: string;
  basis_item_or_action: string;
  auto_score_applied: boolean;
  candidate_score_if_confirmed: number | null;
  matched_rule: string;
  evidence: string;
  reason: string;
  needs_review: boolean;
  review_reasons: string[];
  decision_codes: string[];
  confidence: Confidence;
}

/** evaluations.raw_result — 기사 한 편의 전체 채점 결과 */
export interface EvaluationRawResult {
  prompt_version?: string;
  article_id?: number;
  document_id?: string;
  source_page?: number | null;
  title?: string;
  writer?: string;
  target?: string;
  article_action_summary?: string;
  writer_scoring?: { status: string; score: number | null; reason: string };
  auto_score_total?: number;
  evaluation_needs_review?: boolean;
  evaluation_review_reasons?: string[];
  quality_warnings?: string[];
  practitioner_results?: PractitionerResult[];
  overall_confidence?: Confidence;
}

export type EvaluationStatus = "pending" | "processing" | "done" | "error";

/** GET /api/v1/documents/{id}/evaluations 의 evaluations[] 항목 */
export interface ArticleEvaluation {
  article_id: number;
  document_id: string;
  source_page: number | null;
  title: string;
  writer: string;
  target: string;
  article_needs_review: boolean;
  article_review_reasons: string[];
  evaluation_id: number | null;
  status: EvaluationStatus;
  score: number | null;
  grade: string | null;
  rationale: string | null;
  model: string | null;
  raw_result: EvaluationRawResult | null;
  error_message: string | null;
  evaluated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** 백엔드가 raw_result에서 꺼내 평탄화해 준 값들 */
  evaluation_needs_review: boolean;
  evaluation_review_reasons: string[];
  quality_warnings: string[];
  practitioner_results: PractitionerResult[];
}

export type EvaluationSummaryStatus =
  | "not_ready"
  | "pending"
  | "processing"
  | "completed"
  | "completed_with_errors";

export interface EvaluationSummary {
  document_id: string;
  status: EvaluationSummaryStatus;
  total: number;
  pending: number;
  processing: number;
  done: number;
  error: number;
  needs_review: number;
  progress_percent: number;
}

export interface EvaluationsResponse {
  summary: EvaluationSummary;
  evaluation_count: number;
  evaluations: ArticleEvaluation[];
}

/** POST /api/v1/documents/{id}/evaluate 응답 (summary + status/message) */
export interface StartEvaluationResponse extends EvaluationSummary {
  message: string;
}

export interface SingleEvaluationResponse {
  article_id: number;
  status: EvaluationStatus | "not_created";
  evaluation: ArticleEvaluation | null;
}

/** GET/PUT /api/v1/settings — 비밀값은 마스킹된 형태로만 내려온다 */
export interface ScoringSettingsStatus {
  openai: {
    configured: boolean;
    /** 예: "sk-…abcd" */
    masked: string | null;
    model: string;
    vision_model: string;
  };
  database: {
    configured: boolean;
    /** 비밀번호가 제거된 접속 라벨. 예: "postgresql://user@host:5432/db" */
    label: string | null;
  };
  env_file_exists: boolean;
  /** PUT 응답에서만: 이번에 저장된 필드 */
  saved?: string[];
}

/** 빈 문자열은 "삭제", 생략은 "변경 없음" */
export interface ScoringSettingsUpdate {
  openai_api_key?: string;
  database_url?: string;
}

export interface ScoringSettingsTestResult {
  openai: { ok: boolean; message: string } | null;
  database: { ok: boolean; message: string } | null;
}

// ─── 에러 ────────────────────────────────────────────────────────────────────

/** FastAPI `detail: { code, message }` 형식을 그대로 보존하는 에러 */
export class ScoringApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    /** 백엔드 detail 객체 원본 (예: DUPLICATE_FILE의 document_id) */
    public readonly payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ScoringApiError";
  }
}

export function isScoringApiError(e: unknown): e is ScoringApiError {
  return e instanceof ScoringApiError;
}

// ─── 설정 ────────────────────────────────────────────────────────────────────

/** 백엔드 주소. 비어 있으면 같은 출처(Vite 프록시)로 호출 */
export const SCORING_API_BASE = API_BASE;

const V1 = `${SCORING_API_BASE}/api/v1`;

import { tokenHeaders } from "./auth";
import { API_BASE } from "./config";
import { readHttpError } from "./http";
import { saveBlob } from "../lib/download";

const CONNECTION_ERROR_MESSAGE =
  "분석 서버에 연결할 수 없습니다. 백엔드(SSD_Scoring)가 8000 포트에서 실행 중인지 확인해 주세요.";

// ─── 내부 유틸 ───────────────────────────────────────────────────────────────

async function parseError(res: Response): Promise<ScoringApiError> {
  const err = await readHttpError(res);
  if (err.isConnectionError) return new ScoringApiError(CONNECTION_ERROR_MESSAGE, "CONNECTION_ERROR", err.status);
  return new ScoringApiError(err.message, err.code, err.status, err.payload);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${V1}${path}`, {
      ...init,
      headers: { ...tokenHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new ScoringApiError(CONNECTION_ERROR_MESSAGE, "CONNECTION_ERROR", 0);
  }
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

/** Content-Disposition 헤더에서 파일명 추출 (filename*=UTF-8'' 우선) */
function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* fallthrough */ }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : fallback;
}

async function downloadFile(path: string, fallbackName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${V1}${path}`, { headers: tokenHeaders() });
  } catch {
    throw new ScoringApiError(CONNECTION_ERROR_MESSAGE, "CONNECTION_ERROR", 0);
  }
  if (!res.ok) throw await parseError(res);

  const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), fallbackName);
  saveBlob(await res.blob(), filename);
  return filename;
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

export const scoringApi = {
  /** GET /api/v1/health — 백엔드 연결 확인 */
  health: async (): Promise<boolean> => {
    try {
      const res = await fetch(`${V1}/health`);
      if (!res.ok) return false;
      const data = await res.json() as { status?: string };
      return data.status === "ok";
    } catch {
      return false;
    }
  },

  /** GET /api/v1/documents?limit=N — 최근 업로드 이력 */
  listDocuments: async (limit = 50): Promise<ScoringDocument[]> => {
    const data = await requestJson<{ count: number; documents: ScoringDocument[] }>(
      `/documents?limit=${limit}`,
    );
    return data.documents;
  },

  /**
   * POST /api/v1/documents — PDF 업로드 + 기사 추출 시작 (202)
   * multipart 필드명은 `file`, Content-Type은 브라우저가 boundary 포함해 자동 생성
   */
  uploadDocument: (file: File): Promise<ScoringDocument> => {
    const form = new FormData();
    form.append("file", file);
    return requestJson<ScoringDocument>("/documents", { method: "POST", body: form });
  },

  /** GET /api/v1/documents/{id} — 추출 진행 상태 */
  getDocument: (documentId: string) =>
    requestJson<ScoringDocument>(`/documents/${documentId}`),

  /** GET /api/v1/documents/{id}/articles[?needs_review=true] — 추출 기사 목록 */
  listArticles: (documentId: string, needsReview?: boolean) =>
    requestJson<ExtractedArticlesResponse>(
      `/documents/${documentId}/articles${needsReview != null ? `?needs_review=${needsReview}` : ""}`,
    ),

  /** GET /api/v1/documents/{id}/clipped-pdf — 사랑기사 페이지만 담은 PDF 다운로드 */
  downloadClippedPdf: (documentId: string, fallbackName = "사랑기사.pdf") =>
    downloadFile(`/documents/${documentId}/clipped-pdf`, fallbackName),

  /** POST /api/v1/documents/{id}/evaluate[?force=true] — 문서 전체 점수화 시작 (202) */
  startEvaluation: (documentId: string, force = false) =>
    requestJson<StartEvaluationResponse>(
      `/documents/${documentId}/evaluate${force ? "?force=true" : ""}`,
      { method: "POST" },
    ),

  /** GET /api/v1/documents/{id}/evaluations[?needs_review=true] — 점수화 진행률 + 결과 */
  getEvaluations: (documentId: string, needsReview?: boolean) =>
    requestJson<EvaluationsResponse>(
      `/documents/${documentId}/evaluations${needsReview != null ? `?needs_review=${needsReview}` : ""}`,
    ),

  /** GET /api/v1/documents/{id}/evaluations.xlsx — 로쏘 형식(6컬럼) 점수 엑셀 다운로드 */
  downloadEvaluationsExcel: (documentId: string, fallbackName = "사랑평가결과.xlsx") =>
    downloadFile(`/documents/${documentId}/evaluations.xlsx`, fallbackName),

  /** POST /api/v1/articles/{id}/evaluate — 기사 한 편 재평가 (202) */
  reevaluateArticle: (articleId: number) =>
    requestJson<{ article_id: number; status: string; message: string }>(
      `/articles/${articleId}/evaluate`,
      { method: "POST" },
    ),

  /** GET /api/v1/articles/{id}/evaluation — 기사 한 편 평가 결과 */
  getArticleEvaluation: (articleId: number) =>
    requestJson<SingleEvaluationResponse>(`/articles/${articleId}/evaluation`),

  // ── 백엔드 설정 (OPENAI_API_KEY · DATABASE_URL 웹 입력) ───────────────────

  /** GET /api/v1/settings — 설정 여부(마스킹) 조회. 구버전 백엔드면 404 */
  getSettings: () => requestJson<ScoringSettingsStatus>("/settings"),

  /** PUT /api/v1/settings — .env 저장 + 즉시 반영 */
  updateSettings: (payload: ScoringSettingsUpdate) =>
    requestJson<ScoringSettingsStatus>("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  /** POST /api/v1/settings/test — 값을 주면 저장 없이 그 값으로 연결 시험 */
  testSettings: (payload: ScoringSettingsUpdate & { targets?: ("openai" | "database")[] }) =>
    requestJson<ScoringSettingsTestResult>("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
