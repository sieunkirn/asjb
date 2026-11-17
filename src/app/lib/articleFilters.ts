import type { Article, ArticleFilters, Status } from "../types";

export function filterArticles(articles: Article[], filters: ArticleFilters): Article[] {
  let result = [...articles];

  if (filters.edition != null) {
    result = result.filter(a => a.edition === filters.edition);
  }
  if (filters.status && filters.status !== "전체") {
    result = result.filter(a => a.status === filters.status);
  }
  if (filters.department && filters.department !== "전체") {
    result = result.filter(a => a.department === filters.department);
  }
  if (filters.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    result = result.filter(
      a =>
        a.id.toLowerCase().includes(q) ||
        a.author.includes(q) ||
        a.subject.includes(q) ||
        a.department.includes(q) ||
        (a.basis?.includes(q) ?? false) ||
        (a.flagReason?.includes(q) ?? false),
    );
  }
  return result;
}

export function countByStatus(articles: Article[], status: Status): number {
  return articles.filter(a => a.status === status).length;
}

export function getDepartments(articles: Article[]): string[] {
  return [...new Set(articles.map(a => a.department))].sort();
}

export function getDuplicatePartner(article: Article): string | null {
  if (article.relatedArticleIds?.length) return article.relatedArticleIds[0];
  const match = article.flagReason?.match(/A-\d{4}-\d{3}/g);
  if (match) {
    const other = match.find(id => id !== article.id);
    if (other) return other;
  }
  return null;
}

export function sortReviewQueue(articles: Article[]): Article[] {
  const priority: Record<Status, number> = { "재확인 필요": 0, "승인": 1, "중복 제외": 2 };
  return [...articles].sort((a, b) => priority[a.status] - priority[b.status] || a.id.localeCompare(b.id));
}

export function sortArticles(articles: Article[], sortBy: "priority" | "id" | "subject" | "score-desc" | "score-asc" | "date"): Article[] {
  const list = [...articles];
  switch (sortBy) {
    case "id":
      return list.sort((a, b) => a.id.localeCompare(b.id));
    case "subject":
      return list.sort((a, b) => a.subject.localeCompare(b.subject, "ko"));
    case "score-desc":
      return list.sort((a, b) => b.aiScore - a.aiScore);
    case "score-asc":
      return list.sort((a, b) => a.aiScore - b.aiScore);
    case "date":
      return list.sort((a, b) => b.date.localeCompare(a.date));
    default:
      return sortReviewQueue(list);
  }
}
