import { describe, expect, it } from "vitest";
import { buildLlmMessages, extractAssistantText } from "./llmPrompt";

describe("buildLlmMessages", () => {
  it("시스템·컨텍스트·질문 메시지를 구성한다", () => {
    const messages = buildLlmMessages({
      message: "907호 미처리 몇 건?",
      editionId: 907,
      toolsUsed: ["get_pending_articles"],
      toolResults: {
        get_pending_articles: { editionId: 907, articles: [{ id: "A-2024-002" }] },
      },
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages.at(-1)?.content).toBe("907호 미처리 몇 건?");
    expect(messages.some(m => m.content.includes("DB 조회 결과"))).toBe(true);
  });
});

describe("extractAssistantText", () => {
  it("OpenAI 응답 본문을 추출한다", () => {
    const text = extractAssistantText({
      choices: [{ message: { content: "  **3건**입니다.  " } }],
    });
    expect(text).toBe("**3건**입니다.");
  });
});
