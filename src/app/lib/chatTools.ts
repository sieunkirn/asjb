import type { Article, Edition } from "../types";
import {
  computeArticleStats,
  findPersonName,
  findMatchingArticles,
  parseArticleId,
  parseEditionId,
  DUPLICATE_KEYWORDS,
  EDITION_KEYWORDS,
  PENDING_KEYWORDS,
  SEARCH_KEYWORDS,
  STATS_KEYWORDS,
} from "./chatEngine";

export type ChatToolName =
  | "get_edition_stats"
  | "get_pending_articles"
  | "get_duplicate_pairs"
  | "get_article"
  | "get_person_articles"
  | "get_edition_status"
  | "search_articles";

export interface ChatToolContext {
  editionId: number;
  articles: Article[];
  editions: Edition[];
}

export interface EditionStatsResult {
  editionId: number;
  total: number;
  approved: number;
  pending: number;
  excluded: number;
  approvalRate: number;
  avgAiScore: number;
  avgFinalScore: number;
}

export interface PendingArticlesResult {
  editionId: number;
  articles: Pick<Article, "id" | "subject" | "flagReason" | "status" | "aiScore">[];
}

export interface DuplicatePairsResult {
  editionId: number;
  pairs: { ids: string[]; subject: string }[];
}

export interface ArticleDetailResult {
  article: Article;
}

export interface PersonArticlesResult {
  name: string;
  department: string;
  articles: Article[];
}

export interface EditionStatusResult {
  edition: Edition;
}

export interface SearchArticlesResult {
  query: string;
  count: number;
  articles: Pick<Article, "id" | "edition" | "subject" | "department" | "status" | "aiScore">[];
}

function editionList(articles: Article[], editionId: number): Article[] {
  return articles.filter(a => a.edition === editionId);
}

export function executeChatTool(
  name: ChatToolName,
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): unknown {
  const editionId = (args.editionId as number | undefined) ?? ctx.editionId;

  switch (name) {
    case "get_edition_stats": {
      const list = editionList(ctx.articles, editionId);
      const stats = computeArticleStats(list);
      return {
        editionId,
        total: stats.total,
        approved: stats.approved,
        pending: stats.pending,
        excluded: stats.excluded,
        approvalRate: stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0,
        avgAiScore: stats.avgAiScore,
        avgFinalScore: stats.avgFinalScore,
      } satisfies EditionStatsResult;
    }
    case "get_pending_articles": {
      const pending = editionList(ctx.articles, editionId)
        .filter(a => a.status === "재확인 필요")
        .map(a => ({
          id: a.id,
          subject: a.subject,
          flagReason: a.flagReason,
          status: a.status,
          aiScore: a.aiScore,
        }));
      return { editionId, articles: pending } satisfies PendingArticlesResult;
    }
    case "get_duplicate_pairs": {
      const stats = computeArticleStats(editionList(ctx.articles, editionId));
      return { editionId, pairs: stats.duplicatePairs } satisfies DuplicatePairsResult;
    }
    case "get_article": {
      const id = String(args.articleId ?? "");
      const article = ctx.articles.find(a => a.id === id);
      if (!article) return null;
      return { article } satisfies ArticleDetailResult;
    }
    case "get_person_articles": {
      const name = String(args.name ?? "");
      const related = ctx.articles.filter(a => a.subject === name || a.author === name);
      return {
        name,
        department: related[0]?.department ?? "—",
        articles: related,
      } satisfies PersonArticlesResult;
    }
    case "get_edition_status": {
      const edition = ctx.editions.find(e => e.id === editionId);
      if (!edition) return null;
      // 저장된 articleCount 대신 실제 기사 수로 보정 (데이터가 커져도 정확)
      const liveCount = ctx.articles.filter(a => a.edition === editionId).length;
      return { edition: { ...edition, articleCount: liveCount } } satisfies EditionStatusResult;
    }
    case "search_articles": {
      const query = String(args.query ?? "").trim();
      const matches = findMatchingArticles(query, ctx.articles);
      return {
        query,
        count: matches.length,
        articles: matches
          .sort((a, b) => b.edition - a.edition)
          .slice(0, 10)
          .map(a => ({
            id: a.id,
            edition: a.edition,
            subject: a.subject,
            department: a.department,
            status: a.status,
            aiScore: a.aiScore,
          })),
      } satisfies SearchArticlesResult;
    }
    default:
      return null;
  }
}

/** 메시지에서 호출할 Tool 목록 추론 (LLM tool-calling 대체) */
export function inferChatTools(message: string, ctx: ChatToolContext & { articleId?: string }): ChatToolName[] {
  const msg = message.trim();
  const tools: ChatToolName[] = [];

  const articleId = parseArticleId(msg, ctx.articles) ?? ctx.articleId;
  if (articleId) tools.push("get_article");

  // 기사의 작성자·실천자 이름과 대조해 이름을 인식 (regex 추정 대신)
  const personName = findPersonName(msg, ctx.articles);
  if (personName) tools.push("get_person_articles");

  if (SEARCH_KEYWORDS.some(k => msg.includes(k))) {
    tools.push("search_articles");
  }
  if (!articleId && STATS_KEYWORDS.some(k => msg.includes(k))) {
    tools.push("get_edition_stats");
  }
  if (PENDING_KEYWORDS.some(k => msg.includes(k))) {
    tools.push("get_pending_articles");
  }
  if (DUPLICATE_KEYWORDS.some(k => msg.includes(k))) {
    tools.push("get_duplicate_pairs");
  }
  if (EDITION_KEYWORDS.some(k => msg.includes(k)) || parseEditionId(msg) != null) {
    tools.push("get_edition_status");
  }

  if (tools.length === 0 && !articleId) {
    tools.push("get_edition_stats");
  }

  return [...new Set(tools)];
}

