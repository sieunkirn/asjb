/**
 * 기사 · 호수 · 통계 · 검수를 분석 서버 DB(PostgreSQL)에서 읽고 쓰는 클라이언트
 * ─────────────────────────────────────────────────────────────────────────
 * SSD_Scoring 백엔드의 `api/routes/webapp.py`(`/api/articles`, `/api/editions`,
 * `/api/stats`, `/api/audit`)를 호출합니다. 같은 DATABASE_URL을 쓰는 한
 * 어느 컴퓨터에서든 같은 데이터가 보입니다.
 *
 * - 기본값은 DB 모드입니다. 예전 Mock 데모로 돌리려면 `.env`에
 *   `VITE_ARTICLES_SOURCE=mock` 을 설정하세요.
 * - 챗봇 · 알림 · 로그인 사용자는 백엔드 DB에 해당 데이터가 없어
 *   이 스위치와 무관하게 기존(Mock) 동작을 유지합니다.
 */
import type { Article, AuditLogEntry, DashboardStats, Edition, ReviewContent } from "../types";
import type { ConfirmArticlePayload, ExcludeDuplicatePayload } from "./types";
import { tokenHeaders } from "./auth";
import { API_BASE } from "./config";
import { readHttpError } from "./http";
import { ApiError } from "./types";

/** 기사·호수·통계 데이터를 분석 서버 DB에서 가져올지 여부 (기본: DB) */
export const ARTICLES_FROM_DB = (import.meta.env.VITE_ARTICLES_SOURCE ?? "db") !== "mock";

const BASE = API_BASE;

const CONNECTION_MESSAGE =
  "분석 서버(SSD_Scoring, 8000 포트)에 연결할 수 없습니다. run_api.bat 실행 후 새로고침해 주세요.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...tokenHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new ApiError(CONNECTION_MESSAGE, 0, "CONNECTION_ERROR");
  }
  if (!res.ok) {
    const err = await readHttpError(res);
    if (err.isConnectionError) throw new ApiError(CONNECTION_MESSAGE, err.status, "CONNECTION_ERROR");
    throw new ApiError(err.message, err.status, err.code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * 서버는 켜져 있지만 DB에 연결되지 않은 상태(DATABASE_URL 미설정 · 잘못된 주소 · DB 장애).
 * 이 상태에서도 화면은 열려야 업로드 탭의 '백엔드 설정'에서 DB 주소를 입력할 수 있다.
 * (예전에는 "초기 데이터를 불러오지 못했습니다"에서 멈춰 처음 설치 후 설정할 방법이 없었다)
 */
let dbUnavailable = false;
export const isDbUnavailable = (): boolean => dbUnavailable;

/** 앱 초기 로딩을 막지 않도록, 서버가 꺼져 있거나 DB에 연결되지 않으면 목록은 빈 배열로 대체 */
async function listOrEmpty<T>(path: string): Promise<T[]> {
  try {
    const rows = await request<T[]>(path);
    dbUnavailable = false;
    return rows;
  } catch (e) {
    if (e instanceof ApiError && e.code === "CONNECTION_ERROR") {
      console.warn(`[scoringDb] ${path}: ${e.message}`);
      return [];
    }
    if (e instanceof ApiError && e.code === "DATABASE_ERROR") {
      console.warn(`[scoringDb] ${path}: ${e.message}`);
      dbUnavailable = true;
      return [];
    }
    throw e;
  }
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const scoringDb = {
  listArticles: (edition?: number) =>
    listOrEmpty<Article>(edition != null ? `/api/articles?edition=${edition}` : "/api/articles"),

  getArticle: (id: string) => request<Article>(`/api/articles/${id}`),

  getReview: (id: string) => request<ReviewContent>(`/api/articles/${id}/review`),

  /** 검수 확정 — article_reviews 테이블에 저장됨 */
  confirm: (id: string, payload: ConfirmArticlePayload) =>
    request<Article>(`/api/articles/${id}`, jsonInit("PATCH", payload)),

  /** 중복 제외 — 제외 기사 상태 저장 + 두 기사 연결 */
  excludeDuplicate: (payload: ExcludeDuplicatePayload) =>
    request<Article[]>("/api/articles/exclude-duplicate", jsonInit("POST", payload)),

  getAuditLogs: (articleId?: string) =>
    listOrEmpty<AuditLogEntry>(articleId ? `/api/audit?articleId=${articleId}` : "/api/audit"),

  listEditions: () => listOrEmpty<Edition>("/api/editions"),

  getStats: (edition?: number) =>
    request<DashboardStats>(edition != null ? `/api/stats?edition=${edition}` : "/api/stats"),

  /** 같은 실천자의 다른 기사 이력 (회차 간 중복 확인용) */
  practitionerHistory: (name: string, excludeId?: string) =>
    request<Article[]>(
      `/api/articles/practitioner-history?name=${encodeURIComponent(name)}${excludeId ? `&exclude=${encodeURIComponent(excludeId)}` : ""}`,
    ),

  /** 승인(자동 확정) 상태 + 최종 점수 미확정 건을 AI 점수 그대로 일괄 확정 */
  bulkConfirm: (edition: number, reviewer: string) =>
    request<{ confirmed: number }>("/api/articles/bulk-confirm", jsonInit("POST", { edition, reviewer })),

  /** 호수 발행월·라벨 지정 (edition_meta에 저장) */
  updateEdition: (id: number, patch: { label?: string; month?: string; week?: number }) =>
    request<Edition>(`/api/editions/${id}`, jsonInit("PATCH", patch)),

  /** 호수 삭제 — 그 호수의 업로드 문서·기사·채점·검수 기록이 DB에서 삭제됨 */
  removeEdition: (id: number) => request<void>(`/api/editions/${id}`, { method: "DELETE" }),

  /** DB 모드에서 호수는 업로드 파일명으로 자동 관리 — 수동 편집 미지원 */
  editionsUnsupported: <T>(): Promise<T> =>
    Promise.reject(
      new ApiError(
        "DB 모드에서는 호수가 업로드 PDF 파일명(예: 한가족신문_909호.pdf)으로 자동 관리됩니다.",
        400,
        "EDITIONS_AUTO_MANAGED",
      ),
    ),
};
