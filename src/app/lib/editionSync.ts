import type { Article, Edition, UploadedFile } from "../types";

export interface EditionSyncInput {
  editionId: number;
  articles: Article[];
  uploads: UploadedFile[];
  isProtectedEdition: boolean;
}

export interface EditionSyncResult {
  articleCount: number;
  status: Edition["status"];
  removeFromList: boolean;
}

/** 호수별 기사 수·상태를 계산 (순수 함수 — 단위 테스트용) */
export function computeEditionSync(input: EditionSyncInput): EditionSyncResult {
  const { editionId, articles, uploads, isProtectedEdition } = input;
  const editionArticles = articles.filter(a => a.edition === editionId);
  const count = editionArticles.length;
  const editionUploads = uploads.filter(u => u.edition === editionId);
  const hasActiveUpload = editionUploads.some(u => u.stage !== "done");
  const hasDoneUpload = editionUploads.some(u => u.stage === "done");

  let status: Edition["status"];
  if (count > 0) {
    const pending = editionArticles.some(a => a.status === "재확인 필요");
    const settled = editionArticles.every(a => a.status === "승인" || a.status === "중복 제외");
    status = !pending && settled ? "완료" : "검수 중";
  } else if (hasActiveUpload || hasDoneUpload) {
    status = "검수 중";
  } else {
    status = "업로드 대기";
  }

  const removeFromList = count === 0 && !hasDoneUpload && !hasActiveUpload && !isProtectedEdition;

  return { articleCount: count, status, removeFromList };
}
