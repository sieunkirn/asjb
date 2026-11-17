import type { Article, AuditLogEntry, Edition, Notification, ReviewContent, User } from "../types";
import type { ConfirmArticlePayload, ExcludeDuplicatePayload } from "./types";
import { api, apiCall } from "./client";
import { mockStore } from "./mockStore";
import { ARTICLES_FROM_DB, scoringDb } from "./scoringDb";

/**
 * 기사 · 호수 · 통계는 3원 스위치:
 *  1) DB 모드(기본) — 분석 서버 PostgreSQL (scoringDb.ts, 다른 컴퓨터와 공유)
 *  2) Mock — VITE_ARTICLES_SOURCE=mock 설정 시 (기존 데모)
 *  3) 실API — VITE_API_BASE_URL 설정 시 (기존 Mock↔실API 스위치)
 * 알림 · 로그인 사용자는 백엔드 DB에 데이터가 없어 기존 스위치(2·3)만 사용.
 */
const viaDb = <T>(dbFn: () => Promise<T>, mockFn: () => Promise<T>, realFn: () => Promise<T>): Promise<T> =>
  ARTICLES_FROM_DB ? dbFn() : apiCall(mockFn, realFn);

export const articlesApi = {
  list: (edition?: number) =>
    viaDb(
      () => scoringDb.listArticles(edition),
      () => mockStore.getArticles(edition),
      () => api.get<Article[]>(edition != null ? `/api/articles?edition=${edition}` : "/api/articles"),
    ),

  get: (id: string) =>
    viaDb(
      () => scoringDb.getArticle(id),
      () => mockStore.getArticle(id),
      () => api.get<Article>(`/api/articles/${id}`),
    ),

  getReview: (id: string) =>
    viaDb(
      () => scoringDb.getReview(id),
      () => mockStore.getReviewContent(id),
      () => api.get<ReviewContent>(`/api/articles/${id}/review`),
    ),

  confirm: (id: string, payload: ConfirmArticlePayload) =>
    viaDb(
      () => scoringDb.confirm(id, payload),
      () => mockStore.confirmArticle(id, payload.finalScore, payload.isRereview),
      () => api.patch<Article>(`/api/articles/${id}`, payload),
    ),

  excludeDuplicate: (payload: ExcludeDuplicatePayload) =>
    viaDb(
      () => scoringDb.excludeDuplicate(payload),
      () => mockStore.excludeDuplicate(payload.keepId, payload.excludeId),
      () => api.post<Article[]>("/api/articles/exclude-duplicate", payload),
    ),

  getAuditLogs: (articleId?: string) =>
    viaDb(
      () => scoringDb.getAuditLogs(articleId),
      () => mockStore.getAuditLogs(articleId),
      () => api.get<AuditLogEntry[]>(articleId ? `/api/audit?articleId=${articleId}` : "/api/audit"),
    ),
};

export const editionsApi = {
  list: () =>
    viaDb(
      () => scoringDb.listEditions(),
      () => mockStore.getEditions(),
      () => api.get<Edition[]>("/api/editions"),
    ),

  create: (id: number, label?: string, month?: string, week?: number) =>
    viaDb(
      () => scoringDb.editionsUnsupported<Edition>(),
      () => mockStore.createEdition(id, label, month, week),
      () => api.post<Edition>("/api/editions", { id, label, month, week }),
    ),

  update: (id: number, patch: import("../types").UpdateEditionPayload) =>
    viaDb(
      () => scoringDb.updateEdition(id, patch),
      () => mockStore.updateEdition(id, patch),
      () => api.patch<Edition>(`/api/editions/${id}`, patch),
    ),

  remove: (id: number) =>
    viaDb(
      () => scoringDb.removeEdition(id),
      () => mockStore.deleteEdition(id),
      () => api.delete<void>(`/api/editions/${id}`),
    ),

  resetMock: () =>
    viaDb(
      () => scoringDb.editionsUnsupported<void>(),
      () => mockStore.resetMockData(),
      () => api.post<void>("/api/editions/reset-mock"),
    ),
};

export const authApi = {
  me: () =>
    apiCall(
      () => mockStore.getCurrentUser(),
      () => api.get<User>("/api/auth/me"),
    ),
};

export const notificationsApi = {
  // DB 모드: Mock 가짜 알림(907호·A-2024-…)은 실데이터와 무관하므로 표시하지 않음
  list: () =>
    viaDb(
      () => Promise.resolve<Notification[]>([]),
      () => mockStore.getNotifications(),
      () => api.get<Notification[]>("/api/notifications"),
    ),

  markRead: (id: string) =>
    viaDb(
      () => Promise.resolve(),
      () => mockStore.markNotificationRead(id),
      () => api.patch<void>(`/api/notifications/${id}/read`),
    ),

  markAllRead: () =>
    viaDb(
      () => Promise.resolve(),
      () => mockStore.markAllNotificationsRead(),
      () => api.patch<void>("/api/notifications/read-all"),
    ),
};
