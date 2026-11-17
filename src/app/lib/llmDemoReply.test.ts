import { describe, expect, it } from "vitest";
import { buildDemoLlmReply } from "./llmDemoReply";

describe("buildDemoLlmReply", () => {
  it("통계·미처리 Tool 결과로 자연어 응답을 생성한다", () => {
    const text = buildDemoLlmReply({
      message: "907호 현황",
      editionId: 907,
      llmContext: {
        toolResults: {
          get_edition_stats: {
            editionId: 907,
            total: 10,
            approved: 6,
            pending: 3,
            excluded: 1,
            approvalRate: 60,
            avgAiScore: 3.5,
            avgFinalScore: 4,
          },
          get_pending_articles: {
            articles: [
              { id: "A-2024-002", subject: "최동욱", flagReason: "핫팩", aiScore: 3.1 },
            ],
          },
        },
      },
    });

    expect(text).toContain("907호");
    expect(text).toContain("60%");
    // 목록형 미처리는 상세를 표에 맡기고 텍스트는 건수만 요약한다.
    expect(text).toContain("재확인이 필요한 기사는 **1건**");
  });

  it("검색 결과는 건수만 요약하고 불릿으로 나열하지 않는다", () => {
    const text = buildDemoLlmReply({
      message: "생산팀 기사 찾아줘",
      editionId: 907,
      llmContext: {
        toolResults: {
          search_articles: {
            query: "생산팀",
            count: 3,
            articles: [
              { id: "A-2024-004", edition: 907, subject: "이민호", department: "생산팀", status: "재확인 필요" },
            ],
          },
        },
      },
    });

    expect(text).toContain("생산팀");
    expect(text).toContain("검색 결과는 **3건**");
    expect(text).not.toContain("• **A-2024-004**");
  });
});
