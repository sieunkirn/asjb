import type { Article, ChatAction, ChatHistoryTurn, ChatMessage, Edition, Page } from "../types";
import { nearestAllowedScore } from "./scoreUtils";

export interface ChatQueryContext {
  message: string;
  editionId: number;
  page?: Page;
  articleId?: string;
  history?: ChatHistoryTurn[];
  articles: Article[];
  editions: Edition[];
}

export interface ArticleStats {
  total: number;
  approved: number;
  pending: number;
  excluded: number;
  avgAiScore: number;
  avgFinalScore: number;
  duplicatePairs: { ids: string[]; subject: string }[];
  byDepartment: { department: string; count: number; avgScore: number }[];
}

// 키워드 셋은 chatTools.inferChatTools 와 공유합니다 (단일 소스).
export const STATS_KEYWORDS = ["통계", "승인율", "승인률", "비율", "현황", "요약", "얼마나", "몇 건", "몇건", "진행 상황", "잘 돼", "잘돼"];
export const PENDING_KEYWORDS = ["미처리", "재확인", "대기", "검수 필요", "플래그", "남은", "밀린", "확인 필요", "봐야", "처리 안"];
export const DUPLICATE_KEYWORDS = ["중복", "겹치", "같은 기사", "비슷한 기사"];
export const EDITION_KEYWORDS = ["호수", "호 상태", "진행 상황", "발행"];
export const SEARCH_KEYWORDS = ["찾아", "검색"];
const CURRENT_ARTICLE_KEYWORDS = ["이 기사", "현재 기사", "지금 기사", "플래그", "왜 재확인", "사유"];
const FOLLOWUP_KEYWORDS = ["그 기사", "더 자세히", "자세히", "검수해", "승인해", "비교해", "방금", "아까"];

type ChatBody = Omit<ChatMessage, "role" | "timestamp">;

function articleActions(article: Article): ChatAction[] {
  // 검수 버튼만 유지 (옵션 1).
  // - "중복 비교"는 검수 화면과 동일한 곳으로 이동하고, 리뷰 화면이 중복 짝을 자동으로 띄우므로 생략.
  // - "AI N점 승인"(원클릭 승인)은 챗봇에서 자동 노출하지 않는다. 승인은 검수 화면에서 처리.
  return [
    {
      id: `${article.id}-review`,
      type: "open_review",
      label: `${article.id} 검수`,
      articleId: article.id,
    },
  ];
}

function pendingListActions(): ChatAction[] {
  // "검수 목록 열기" 하나만. (대시보드 필터 버튼은 같은 재확인 목록을 다른 화면에서 또 보여줘 중복이라 제거)
  return [
    {
      id: "nav-review-list",
      type: "navigate_review_list",
      label: "검수 목록 열기",
      page: "review",
    },
  ];
}

export function extractHistoryContext(history: ChatHistoryTurn[] = []): {
  lastArticleId?: string;
  lastPerson?: string;
} {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    const fromText = parseArticleId(turn.text);
    if (fromText) return { lastArticleId: fromText };
    if (turn.articleId) return { lastArticleId: turn.articleId };
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const nameMatch = history[i].text.match(/([가-힣]{2,4})\s*(관련|기사|이력)/);
    if (nameMatch) return { lastPerson: nameMatch[1] };
  }
  return {};
}

function isFollowUpMessage(message: string): boolean {
  return FOLLOWUP_KEYWORDS.some(k => message.includes(k));
}

const DEPARTMENTS = ["생산팀", "영업팀", "기획팀", "품질팀", "물류팀", "인사팀"];

/** "○건"이 개수 표현으로 쓰였을 가능성이 큰 문맥 (미처리 40건, 승인 36건 …) */
const COUNT_CONTEXT = /미처리|승인|중복|재확인|목록|건수|현황|평균/;

export function parseArticleId(message: string, articleList: Article[] = []): string | null {
  // Mock 형식 (A-2024-002)
  const mock = message.match(/A-\d{4}-\d{3}/i);
  if (mock) return mock[0].toUpperCase();

  // 기사 목록이 주어지면 실제 존재하는 id만 인식한다 (숫자 오인 방지)
  const ids = articleList.length ? new Set(articleList.map(a => a.id)) : null;

  // DB 형식 — 실천자 행 id("1810-2")
  for (const m of message.matchAll(/(\d{2,6}-\d{1,2})(?![\d-])/g)) {
    if (!ids || ids.has(m[1])) return m[1];
  }

  // 실천자 행만 있는 기사(1810-1, 1810-2…)는 기준 id("1810")로도 인식한다
  const knownBase = (token: string): boolean =>
    !ids || ids.has(token) || articleList.some(a => a.id.startsWith(`${token}-`));

  // DB 형식 — 기사 id("1810"). 단위 숫자(956호·5명·3개 등)는 제외하되,
  // "1810건"처럼 실존하는 기사 id를 부르는 표현은 개수 문맥이 아니면 인식한다
  for (const m of message.matchAll(/(?:^|[^\d.\-])(\d{2,6})(?:\s*([호건점명개회월년일주차%]))?/g)) {
    const token = m[1];
    const unit = m[2];
    if (unit && unit !== "건") continue;
    if (!knownBase(token)) continue;
    if (unit === "건" && (!ids || COUNT_CONTEXT.test(message))) continue;
    return token;
  }
  return null;
}

export function parseEditionId(message: string): number | null {
  const m = message.match(/(\d{3,4})\s*호/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 100 && n <= 9999 ? n : null;
}

/**
 * 질문에서 기사의 작성자·실천자 이름을 찾는다 (인사 명부가 없으므로 기사 데이터 기준).
 * "-"·"미지정" 같은 자리표시 값은 "1810-2" 같은 질문과 우연히 맞는 것을 막기 위해 제외한다.
 */
export function findPersonName(message: string, articleList: Article[] = []): string | null {
  const names = new Set<string>();
  articleList.forEach(a => {
    names.add(a.author);
    names.add(a.subject);
  });
  const sorted = [...names]
    .filter(n => n && n.length >= 2 && n !== "-" && n !== "미지정" && n !== "미기재")
    .sort((a, b) => b.length - a.length);
  return sorted.find(n => message.includes(n)) ?? null;
}

export function findDepartment(message: string): string | null {
  return DEPARTMENTS.find(d => message.includes(d)) ?? null;
}

/** "생산팀 기사 찾아줘" → "생산팀" 처럼 검색어만 추출 */
export function extractSearchQuery(message: string): string {
  return message
    .replace(/관련(된)?\s*기사/g, " ")
    .replace(/기사/g, " ")
    .replace(/(찾아줘|찾아봐|찾아보|찾아|검색해줘|검색해|검색|알려줘|보여줘)/g, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 실천자·작성자·부서·플래그 사유·근거·ID를 키워드로 전역 검색 */
export function findMatchingArticles(query: string, articles: Article[]): Article[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return articles.filter(a =>
    a.subject.toLowerCase().includes(q) ||
    a.author.toLowerCase().includes(q) ||
    a.department.toLowerCase().includes(q) ||
    a.id.toLowerCase().includes(q) ||
    (a.flagReason?.toLowerCase().includes(q) ?? false) ||
    (a.basis?.toLowerCase().includes(q) ?? false),
  );
}

export function computeArticleStats(articles: Article[]): ArticleStats {
  const approved = articles.filter(a => a.status === "승인");
  const withFinal = approved.filter(a => a.finalScore != null);
  const deptMap = new Map<string, { count: number; total: number }>();

  articles.forEach(a => {
    const cur = deptMap.get(a.department) ?? { count: 0, total: 0 };
    deptMap.set(a.department, {
      count: cur.count + 1,
      total: cur.total + (a.finalScore ?? a.aiScore),
    });
  });

  const seen = new Set<string>();
  const duplicatePairs: ArticleStats["duplicatePairs"] = [];
  articles.forEach(a => {
    if (a.relatedArticleIds?.length) {
      const key = [a.id, a.relatedArticleIds[0]].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        duplicatePairs.push({ ids: [a.id, a.relatedArticleIds[0]], subject: a.subject });
      }
    }
  });

  return {
    total: articles.length,
    approved: approved.length,
    pending: articles.filter(a => a.status === "재확인 필요").length,
    excluded: articles.filter(a => a.status === "중복 제외").length,
    avgAiScore: articles.length
      ? +(articles.reduce((s, a) => s + a.aiScore, 0) / articles.length).toFixed(1)
      : 0,
    avgFinalScore: withFinal.length
      ? +(withFinal.reduce((s, a) => s + (a.finalScore ?? 0), 0) / withFinal.length).toFixed(1)
      : 0,
    byDepartment: [...deptMap.entries()].map(([department, v]) => ({
      department,
      count: v.count,
      avgScore: +(v.total / v.count).toFixed(1),
    })),
    duplicatePairs,
  };
}

function editionArticles(articles: Article[], editionId: number): Article[] {
  return articles.filter(a => a.edition === editionId);
}

function buildStatsResponse(editionId: number, articles: Article[]): ChatBody {
  const list = editionArticles(articles, editionId);
  const stats = computeArticleStats(list);
  const approvalRate = stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0;
  return {
    text: `${editionId}호 승인률 **${approvalRate}%** (${stats.approved}/${stats.total}건), 평균 AI **${stats.avgAiScore}**, 평균 최종 **${stats.avgFinalScore}** · 재확인 **${stats.pending}** · 중복제외 **${stats.excluded}**`,
    actions: stats.pending > 0 ? pendingListActions() : undefined,
  };
}

function buildPendingResponse(editionId: number, articles: Article[]): ChatBody {
  const pending = editionArticles(articles, editionId).filter(a => a.status === "재확인 필요");
  if (pending.length === 0) {
    return { text: `${editionId}호 재확인 필요 기사가 **없습니다**. 모두 처리되었거나 승인·중복제외 상태입니다.` };
  }
  const shown = pending.slice(0, 8);
  const more = pending.length - shown.length;
  return {
    text: `${editionId}호 재확인 필요 **${pending.length}건**입니다.${more > 0 ? ` (표에는 앞 8건만 표시 · 전체는 "검수 목록 열기")` : ""}`,
    table: {
      headers: ["기사 ID", "실천자", "플래그 사유"],
      // 가독성: 말풍선이 너무 길어지지 않도록 앞 8건만. 전체는 검수 목록에서 확인.
      rows: shown.map(a => [a.id, a.subject, a.flagReason ?? "—"]),
    },
    // 개별 기사 검수 버튼은 두지 않는다. 건수가 많아지면 버튼이 넘치고,
    // "검수 목록 열기"로 전체를 볼 수 있으므로 목록 이동 버튼만 남긴다.
    actions: pendingListActions(),
  };
}

function buildDuplicateResponse(editionId: number, articles: Article[]): ChatBody {
  const stats = computeArticleStats(editionArticles(articles, editionId));
  if (stats.duplicatePairs.length === 0) {
    return { text: `${editionId}호 중복 의심 기사가 **없습니다**.` };
  }
  const pairText = stats.duplicatePairs.map(p => `${p.ids.join("↔")}(${p.subject})`).join(", ");
  return {
    text: `${editionId}호 중복 의심 **${stats.duplicatePairs.length}쌍** · ${pairText}. 검수 화면에서 **나란히 비교**할 수 있습니다.`,
    // 쌍마다 검수 버튼 1개만. 검수 화면이 중복 짝 비교 패널을 자동으로 띄운다.
    actions: stats.duplicatePairs.slice(0, 3).map(p => ({
      id: `${p.ids[0]}-review`,
      type: "open_review" as const,
      label: `${p.ids[0]} 검수`,
      articleId: p.ids[0],
    })),
  };
}

function buildEditionStatusResponse(editionId: number, editions: Edition[], articles: Article[]): ChatBody {
  const ed = editions.find(e => e.id === editionId);
  if (!ed) {
    return { text: `${editionId}호는 목록에 **없습니다**. 업로드 페이지에서 새 호수를 추가할 수 있습니다.` };
  }
  // 저장된 articleCount 대신 실제 기사 수를 집계 (데이터가 커져도 정확)
  const list = editionArticles(articles, editionId);
  const pending = list.filter(a => a.status === "재확인 필요").length;
  return {
    text: `${ed.label} · **${ed.status}** · 기사 **${list.length}건** · ${ed.month}`,
    actions: pending > 0 ? pendingListActions() : undefined,
  };
}

function buildArticleResponse(article: Article): ChatBody {
  return {
    text: `**${article.id}** (${article.edition}호) · ${article.subject} · ${article.status} · AI **${article.aiScore}**${article.finalScore != null ? ` → 최종 **${article.finalScore}**` : ""}`,
    table: {
      headers: ["항목", "내용"],
      rows: [
        ["작성자", article.author],
        ["실천자", article.subject],
        ["부서", article.department],
        ["플래그", article.flagReason ?? "없음"],
      ],
    },
    actions: articleActions(article),
  };
}

/** 실천자별 행으로 나뉜 기사(1810-1, 1810-2…)를 한 번에 보여준다 */
function buildArticleGroupResponse(baseId: string, rows: Article[]): ChatBody {
  const first = rows[0];
  return {
    text: `**${baseId}** 기사 (${first.edition}호) · 작성자 ${first.author} · 실천자 **${rows.length}명**`,
    table: {
      headers: ["행 ID", "실천자", "상태", "점수"],
      rows: rows.map(a => [
        a.id,
        a.subject,
        a.status,
        a.finalScore != null ? `최종 ${a.finalScore}` : `AI ${a.aiScore}`,
      ]),
    },
    links: rows.slice(0, 10).map(a => ({ label: `${a.id} ${a.subject} 검수`, id: a.id })),
  };
}

function buildPersonResponse(name: string, articles: Article[]): ChatBody {
  const related = articles.filter(a => a.subject === name || a.author === name);
  if (related.length === 0) {
    return { text: `**${name}** 관련 기사를 찾지 못했습니다.` };
  }
  const dept = related[0].department;
  return {
    text: `**${name}**(${dept}) 관련 기사 **${related.length}건**입니다.`,
    table: {
      headers: ["호수", "기사 ID", "AI", "최종", "상태"],
      rows: related
        .sort((a, b) => b.edition - a.edition)
        .slice(0, 8)
        .map(a => [
          `${a.edition}호`,
          a.id,
          String(a.aiScore),
          a.finalScore != null ? String(a.finalScore) : "—",
          a.status,
        ]),
    },
    actions: related
      .filter(a => a.status === "재확인 필요")
      .slice(0, 2)
      .flatMap(a => articleActions(a).slice(0, 1)),
  };
}

function buildDepartmentResponse(dept: string, editionId: number, articles: Article[]): ChatBody {
  const list = editionArticles(articles, editionId).filter(a => a.department === dept);
  if (list.length === 0) {
    return { text: `${editionId}호 **${dept}** 기사가 없습니다.` };
  }
  const stats = computeArticleStats(list);
  return {
    text: `${editionId}호 **${dept}** · ${stats.total}건 · 승인 ${stats.approved} · 재확인 ${stats.pending} · 평균 AI **${stats.avgAiScore}**`,
    table: {
      headers: ["기사 ID", "실천자", "상태", "AI"],
      rows: list.slice(0, 6).map(a => [a.id, a.subject, a.status, String(a.aiScore)]),
    },
  };
}

function buildSearchResponse(query: string, articles: Article[]): ChatBody {
  if (!query) {
    return { text: `무엇을 찾아드릴까요? 실천자·부서·플래그 사유 같은 키워드를 포함해 다시 질문해 주세요.` };
  }
  const matches = findMatchingArticles(query, articles);
  if (matches.length === 0) {
    return { text: `**"${query}"** 로 검색된 기사가 **없습니다**. 다른 키워드로 시도해 보세요.` };
  }
  return {
    text: `**"${query}"** 검색 결과 **${matches.length}건**입니다.`,
    table: {
      headers: ["호수", "기사 ID", "실천자", "상태"],
      rows: matches
        .sort((a, b) => b.edition - a.edition)
        .slice(0, 8)
        .map(a => [`${a.edition}호`, a.id, a.subject, a.status]),
    },
    actions: matches.slice(0, 2).flatMap(a => articleActions(a).slice(0, 1)),
  };
}

function buildCurrentArticleResponse(article: Article): ChatBody {
  const flag = article.flagReason ?? "특이 플래그 없음";
  const dup = article.relatedArticleIds?.length
    ? ` 중복 비교 대상: **${article.relatedArticleIds.join(", ")}**`
    : "";
  return {
    text: `검수 중인 **${article.id}** · ${article.subject} · ${article.status} · AI **${article.aiScore}**. 플래그: ${flag}.${dup}`,
    actions: articleActions(article),
  };
}

export function resolveChatResponse(ctx: ChatQueryContext): ChatBody {
  const { message, articles, editions, history } = ctx;
  const editionId = parseEditionId(message) ?? ctx.editionId;
  const msg = message.trim();
  const historyCtx = extractHistoryContext(history);

  if (isFollowUpMessage(msg) && historyCtx.lastArticleId) {
    const article = articles.find(a => a.id === historyCtx.lastArticleId);
    if (article) {
      if (msg.includes("승인") && article.status === "재확인 필요") {
        const score = nearestAllowedScore(article.aiScore);
        return {
          text: `**${article.id}**를 AI 제안 **${score}점**으로 승인할까요? 아래 버튼을 눌러 확정하세요.`,
          actions: [{
            id: `${article.id}-confirm-followup`,
            type: "confirm_score",
            label: `${score}점 승인 확정`,
            articleId: article.id,
            suggestedScore: score,
          }],
        };
      }
      if (msg.includes("비교") && article.relatedArticleIds?.[0]) {
        return {
          text: `**${article.id}**와 **${article.relatedArticleIds[0]}** 중복 비교 화면으로 이동할 수 있습니다.`,
          actions: [{
            id: `${article.id}-dup-followup`,
            type: "open_duplicate_compare",
            label: "중복 비교 열기",
            articleId: article.id,
            compareWithId: article.relatedArticleIds[0],
          }],
        };
      }
      return buildArticleResponse(article);
    }
  }

  if (ctx.articleId && CURRENT_ARTICLE_KEYWORDS.some(k => msg.includes(k))) {
    const current = articles.find(a => a.id === ctx.articleId);
    if (current) return buildCurrentArticleResponse(current);
  }

  const articleId = parseArticleId(msg, articles);
  if (articleId) {
    const article = articles.find(a => a.id === articleId);
    if (article) return buildArticleResponse(article);
    // 실천자별 행으로 나뉜 기사(1810-1, 1810-2…)는 전원을 표로 보여준다
    const rows = articles.filter(a => a.id.startsWith(`${articleId}-`));
    if (rows.length > 0) return buildArticleGroupResponse(articleId, rows);
    return { text: `**${articleId}** 기사를 찾지 못했습니다.` };
  }

  const personName = findPersonName(msg, articles);
  if (personName && !STATS_KEYWORDS.some(k => msg.includes(k))) {
    return buildPersonResponse(personName, articles);
  }

  if (STATS_KEYWORDS.some(k => msg.includes(k))) {
    return buildStatsResponse(editionId, articles);
  }

  if (PENDING_KEYWORDS.some(k => msg.includes(k))) {
    return buildPendingResponse(editionId, articles);
  }

  if (DUPLICATE_KEYWORDS.some(k => msg.includes(k))) {
    return buildDuplicateResponse(editionId, articles);
  }

  const dept = findDepartment(msg);
  if (dept) {
    return buildDepartmentResponse(dept, editionId, articles);
  }

  if (SEARCH_KEYWORDS.some(k => msg.includes(k))) {
    return buildSearchResponse(extractSearchQuery(msg), articles);
  }

  if (EDITION_KEYWORDS.some(k => msg.includes(k)) || parseEditionId(msg) != null) {
    return buildEditionStatusResponse(editionId, editions, articles);
  }

  return {
    text: `${editionId}호 기준으로 도와드릴게요. **미처리**, **중복**, **승인률**, **1810** 같은 기사 ID, 또는 **실천자 이름**을 포함해 질문해 주세요.`,
    // 매칭되는 질문이 없을 때도 최소 이동 수단(대시보드 전체 보기)을 제공한다.
    actions: [
      {
        id: "default-dashboard",
        type: "filter_dashboard",
        label: "대시보드 보기",
        filterStatus: "전체",
      },
    ],
  };
}

export function buildSuggestedPrompts(ctx: Pick<ChatQueryContext, "editionId" | "articleId" | "page" | "articles" | "editions">): string[] {
  const { editionId, articleId, page, articles, editions } = ctx;
  const list = editionArticles(articles, editionId);
  const stats = computeArticleStats(list);
  const prompts: string[] = [];

  if (articleId && page === "review") {
    prompts.push("이 기사 플래그 사유");
  }

  if (stats.pending > 0) {
    prompts.push(`${editionId}호 미처리 ${stats.pending}건`);
  }

  if (stats.duplicatePairs.length > 0) {
    prompts.push(`중복 의심 ${stats.duplicatePairs.length}쌍`);
  }

  prompts.push(`${editionId}호 승인률은?`);

  const ed = editions.find(e => e.id === editionId);
  if (ed?.status === "업로드 대기") {
    prompts.push(`${editionId}호 상태`);
  }

  if (prompts.length < 3) {
    const pending = list.find(a => a.status === "재확인 필요");
    if (pending) prompts.push(`${pending.subject} 기사 조회`);
  }

  return [...new Set(prompts)].slice(0, 4);
}

export function buildWelcomePreset(
  editionId: number,
  articles: Article[],
): { role: "user" | "ai"; text: string; table?: ChatMessage["table"]; actions?: ChatAction[] }[] {
  const pending = editionArticles(articles, editionId).filter(a => a.status === "재확인 필요");
  const userText = `${editionId}호 검수 도와줘`;
  if (pending.length === 0) {
    return [
      { role: "user", text: userText },
      {
        role: "ai",
        text: `${editionId}호는 현재 **재확인 필요 기사가 없습니다**. 승인률이나 호수 상태를 물어보세요.`,
      },
    ];
  }
  return [
    { role: "user", text: userText },
    {
      role: "ai",
      text: `${editionId}호 재확인 필요 **${pending.length}건**입니다. 아래 버튼으로 바로 이동하세요.`,
      table: {
        headers: ["기사 ID", "실천자", "플래그"],
        rows: pending.slice(0, 4).map(a => [a.id, a.subject, a.flagReason ?? "—"]),
      },
      actions: [
        ...pendingListActions(),
        ...pending.slice(0, 1).flatMap(a => articleActions(a)),
      ],
    },
  ];
}
