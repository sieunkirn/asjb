import type { Article } from "../types";
import { nearestAllowedScore } from "./scoreUtils";

/** DB 시트 열 순서 (고정) */
export const DB_EXCEL_COLUMNS = [
  "작성자",
  "실천자",
  "실천자 부서",
  "실천 내용 요약",
  "실천 내용 점수",
  "특이사항",
] as const;

export type DbExcelRow = Record<(typeof DB_EXCEL_COLUMNS)[number], string | number>;

/** 검수 기사 → DB 양식 행 변환 */
export function articleToDbRow(article: Article): DbExcelRow {
  let score: string | number = "";
  let notes = article.flagReason?.trim() ?? "";

  if (article.status === "중복 제외") {
    score = 0;
    if (!notes) notes = "중복 기사 제외";
    else if (!notes.includes("중복")) notes = `중복 기사 제외 / ${notes}`;
  } else if (article.finalScore != null) {
    score = Math.round(article.finalScore);
  } else if (article.status === "재확인 필요") {
    score = "";
    if (!notes) notes = "검토 필요";
  } else {
    score = nearestAllowedScore(article.aiScore);
  }

  return {
    "작성자": article.author,
    "실천자": article.subject,
    "실천자 부서": article.department,
    "실천 내용 요약": article.basis?.trim() ?? "",
    "실천 내용 점수": score,
    "특이사항": notes,
  };
}

export function articlesToDbRows(articles: Article[]): DbExcelRow[] {
  return articles.map(articleToDbRow);
}
