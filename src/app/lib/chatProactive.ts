import type { Article, ChatAction, ChatMessage } from "../types";
import { computeArticleStats } from "./chatEngine";

export function buildProactiveBriefing(
  editionId: number,
  articles: Article[],
): Omit<ChatMessage, "role" | "timestamp"> | null {
  const list = articles.filter(a => a.edition === editionId);
  const stats = computeArticleStats(list);

  if (stats.pending === 0 && stats.duplicatePairs.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (stats.pending > 0) parts.push(`재확인 **${stats.pending}건**`);
  if (stats.duplicatePairs.length > 0) parts.push(`중복 의심 **${stats.duplicatePairs.length}쌍**`);

  // "검수 목록 열기" 하나만 (미처리·중복 어느 경우든 동일).
  const actions: ChatAction[] = [];
  if (stats.pending > 0 || stats.duplicatePairs.length > 0) {
    actions.push({
      id: "proactive-review",
      type: "navigate_review_list",
      label: "검수 목록 열기",
      page: "review",
    });
  }

  return {
    text: `${editionId}호 — ${parts.join(" · ")}. 바로 처리할까요?`,
    actions,
    meta: { proactive: true, toolsUsed: ["get_pending_articles", "get_duplicate_pairs"], provider: "rule" },
  };
}
