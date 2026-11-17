import { describe, expect, it } from "vitest";
import { filterActionsByRole } from "./chatPermissions";
import { orchestrateChat } from "./chatOrchestrator";
import { buildProactiveBriefing } from "./chatProactive";
import { inferChatTools, executeChatTool } from "./chatTools";
import type { Article, Edition } from "../types";

const articles: Article[] = [
  { id: "A-2024-002", edition: 907, author: "이서연", subject: "최동욱", department: "영업팀", aiScore: 3.1, status: "재확인 필요", date: "2024-01-15" },
  { id: "A-2024-004", edition: 907, author: "김태영", subject: "이민호", department: "생산팀", aiScore: 2.5, status: "재확인 필요", date: "2024-01-16", relatedArticleIds: ["A-2024-007"] },
  { id: "A-2024-007", edition: 907, author: "신재원", subject: "이민호", department: "생산팀", aiScore: 2.6, status: "재확인 필요", date: "2024-01-18", relatedArticleIds: ["A-2024-004"] },
  { id: "A-2024-001", edition: 907, author: "김민지", subject: "박준호", department: "생산팀", aiScore: 4.2, finalScore: 4, status: "승인", date: "2024-01-15" },
];

const editions: Edition[] = [
  { id: 907, label: "907호", month: "2024년 1월", status: "검수 중", articleCount: 4 },
];

describe("inferChatTools", () => {
  it("미처리 질문에 pending·stats tool을 추론한다", () => {
    const tools = inferChatTools("907호 미처리 건", { editionId: 907, articles, editions });
    expect(tools).toContain("get_pending_articles");
  });

  it("검색 키워드가 있으면 search_articles를 추론한다", () => {
    const tools = inferChatTools("생산팀 기사 찾아줘", { editionId: 907, articles, editions });
    expect(tools).toContain("search_articles");
  });

  it("기사에 나온 실천자 이름을 인식해 get_person_articles를 추론한다", () => {
    const tools = inferChatTools("이민호 관련 기사", { editionId: 907, articles, editions });
    expect(tools).toContain("get_person_articles");
  });
});

describe("executeChatTool", () => {
  it("get_edition_stats가 승인률을 반환한다", () => {
    const result = executeChatTool("get_edition_stats", { editionId: 907 }, { editionId: 907, articles, editions }) as { approved: number; total: number };
    expect(result.total).toBe(4);
    expect(result.approved).toBe(1);
  });

  it("search_articles가 부서 키워드로 전체 호수 기사를 찾는다", () => {
    const result = executeChatTool("search_articles", { query: "생산팀" }, { editionId: 907, articles, editions }) as { count: number; articles: { id: string }[] };
    expect(result.count).toBe(3);
    expect(result.articles.map(a => a.id)).toContain("A-2024-004");
  });

  it("search_articles가 매칭 없으면 count 0을 반환한다", () => {
    const result = executeChatTool("search_articles", { query: "존재하지않는키워드" }, { editionId: 907, articles, editions }) as { count: number };
    expect(result.count).toBe(0);
  });
});

describe("filterActionsByRole", () => {
  it("viewer는 confirm_score 액션을 제외한다", () => {
    const actions = filterActionsByRole([
      { id: "1", type: "confirm_score", label: "승인", articleId: "A-2024-002", suggestedScore: 3 },
      { id: "2", type: "open_review", label: "열기", articleId: "A-2024-002" },
    ], "viewer");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("open_review");
  });
});

describe("orchestrateChat", () => {
  it("응답 meta에 toolsUsed와 provider를 포함한다", () => {
    const res = orchestrateChat({
      message: "907호 통계",
      editionId: 907,
      articles,
      editions,
      userRole: "reviewer",
    });
    expect(res.provider).toBe("rule");
    expect(res.body.meta?.toolsUsed?.length).toBeGreaterThan(0);
    expect(res.body.meta?.provider).toBe("rule");
  });
});

describe("buildProactiveBriefing", () => {
  it("미처리·중복이 있으면 브리핑을 생성한다", () => {
    const briefing = buildProactiveBriefing(907, articles);
    expect(briefing).not.toBeNull();
    expect(briefing?.text).toContain("재확인");
    expect(briefing?.meta?.proactive).toBe(true);
    expect(briefing?.actions?.length).toBeGreaterThan(0);
  });

  it("처리할 건이 없으면 null을 반환한다", () => {
    const done = articles.map(a => ({ ...a, status: "승인" as const, relatedArticleIds: undefined }));
    expect(buildProactiveBriefing(907, done)).toBeNull();
  });
});
