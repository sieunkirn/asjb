import { describe, expect, it } from "vitest";
import {
  buildSuggestedPrompts,
  parseArticleId,
  resolveChatResponse,
  extractHistoryContext,
} from "./chatEngine";
import type { Article, Edition } from "../types";

const articles: Article[] = [
  {
    id: "A-2024-002",
    edition: 907,
    author: "이서연",
    subject: "최동욱",
    department: "영업팀",
    aiScore: 3.1,
    status: "재확인 필요",
    date: "2024-01-15",
    flagReason: "핫팩",
  },
  {
    id: "A-2024-004",
    edition: 907,
    author: "김태영",
    subject: "이민호",
    department: "생산팀",
    aiScore: 2.5,
    status: "재확인 필요",
    date: "2024-01-16",
    relatedArticleIds: ["A-2024-007"],
  },
  {
    id: "A-2024-007",
    edition: 907,
    author: "신재원",
    subject: "이민호",
    department: "생산팀",
    aiScore: 2.6,
    status: "재확인 필요",
    date: "2024-01-18",
    relatedArticleIds: ["A-2024-004"],
  },
  {
    id: "A-2024-001",
    edition: 907,
    author: "김민지",
    subject: "박준호",
    department: "생산팀",
    aiScore: 4.2,
    finalScore: 4,
    status: "승인",
    date: "2024-01-15",
  },
];

const editions: Edition[] = [
  { id: 907, label: "907호", month: "2024년 1월", status: "검수 중", articleCount: 4 },
];

describe("parseArticleId", () => {
  it("기사 ID를 파싱한다", () => {
    expect(parseArticleId("A-2024-002 상태")).toBe("A-2024-002");
  });

  it("DB 숫자 id와 실천자 행 id를 인식한다", () => {
    expect(parseArticleId("1810 기사 알려줘")).toBe("1810");
    expect(parseArticleId("1810-2 상태 어때")).toBe("1810-2");
  });

  it("목록 대조: '1810건들 알려줘'처럼 건이 붙어도 실존 id면 인식한다", () => {
    const list = [{ id: "1810-1" }, { id: "1810-2" }, { id: "40" }] as never[];
    expect(parseArticleId("1810건들 알려줘", list)).toBe("1810");
    expect(parseArticleId("1810건 내용 보여줘", list)).toBe("1810");
    // 개수 문맥에서는 id와 겹쳐도 개수로 취급
    expect(parseArticleId("956호 미처리 40건", list)).toBeNull();
    expect(parseArticleId("미처리 40건 보여줘", list)).toBeNull();
    // 목록에 없는 숫자는 id로 보지 않음
    expect(parseArticleId("9999 알려줘", list)).toBeNull();
  });

  it("호수·건수·점수 등 단위 숫자는 기사 id로 오인하지 않는다", () => {
    expect(parseArticleId("956호 미처리 24건")).toBeNull();
    expect(parseArticleId("상위 10명 알려줘")).toBeNull();
    expect(parseArticleId("최근 3개 호수 승인률")).toBeNull();
  });
});

describe("resolveChatResponse", () => {
  it("선택 호수 기준 미처리 목록을 반환한다", () => {
    const res = resolveChatResponse({
      message: "907호 미처리 건",
      editionId: 907,
      articles,
      editions,
    });
    expect(res.text).toContain("3건");
    expect(res.table?.rows.length).toBe(3);
  });

  it("실천자 이름으로 이력을 조회한다", () => {
    const res = resolveChatResponse({
      message: "이민호 기사",
      editionId: 907,
      articles,
      editions,
    });
    expect(res.text).toContain("이민호");
    expect(res.table?.rows.length).toBe(2);
  });

  it("검수 중 기사 컨텍스트를 우선한다", () => {
    const res = resolveChatResponse({
      message: "이 기사 플래그 사유",
      editionId: 907,
      articleId: "A-2024-004",
      page: "review",
      articles,
      editions,
    });
    expect(res.text).toContain("A-2024-004");
    expect(res.text).toContain("이민호");
  });
});

describe("resolveChatResponse actions", () => {
  it("미처리 응답에 검수 목록 열기 액션만 포함한다", () => {
    const res = resolveChatResponse({
      message: "907호 미처리",
      editionId: 907,
      articles,
      editions,
    });
    expect(res.actions?.some(a => a.type === "navigate_review_list")).toBe(true);
    // 대시보드 필터 버튼은 검수 목록과 중복이라 제거됨
    expect(res.actions?.some(a => a.type === "filter_dashboard")).toBe(false);
  });
});

describe("extractHistoryContext", () => {
  it("이전 턴의 기사 ID를 추출한다", () => {
    const ctx = extractHistoryContext([
      { role: "user", text: "A-2024-004 알려줘" },
      { role: "ai", text: "답변" },
    ]);
    expect(ctx.lastArticleId).toBe("A-2024-004");
  });
});

describe("buildSuggestedPrompts", () => {
  it("미처리·중복·승인률 칩을 생성한다", () => {
    const prompts = buildSuggestedPrompts({
      editionId: 907,
      page: "dashboard",
      articles,
      editions,
    });
    expect(prompts.some(p => p.includes("미처리"))).toBe(true);
    expect(prompts.some(p => p.includes("승인률"))).toBe(true);
  });
});

