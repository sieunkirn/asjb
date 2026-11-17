import type { ChatHistoryTurn } from "../types";

export interface LlmPromptInput {
  message: string;
  editionId?: number;
  page?: string;
  articleId?: string;
  history?: ChatHistoryTurn[];
  userRole?: string;
  toolsUsed?: string[];
  toolResults?: Record<string, unknown>;
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `당신은 성심당 「사랑기사」 평가 시스템의 AI 비서입니다.
검수자·관리자가 기사 승인, 재확인, 중복 검토를 빠르게 할 수 있도록 돕습니다.

규칙:
- 반드시 한국어로 답변합니다.
- 제공된 DB 조회 결과(toolResults)만 근거로 사용하고, 없는 수치·기사 ID를 지어내지 않습니다.
- 간결하고 실무적으로 답합니다 (2~5문장, 필요 시 불릿).
- 중요 숫자·기사 ID는 **굵게** 표시합니다 (예: **907호**, **A-2024-002**).
- 검수·승인·중복 비교 등은 앱 버튼으로 처리하므로, "아래 버튼을 눌러주세요" 정도로 안내합니다.
- viewer 역할에게는 승인 실행을 요청하지 않습니다.`;

export function buildLlmMessages(input: LlmPromptInput): LlmChatMessage[] {
  const messages: LlmChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const contextLines: string[] = [];
  if (input.editionId != null) contextLines.push(`선택 호수: ${input.editionId}호`);
  if (input.page) contextLines.push(`현재 화면: ${input.page}`);
  if (input.articleId) contextLines.push(`열린 기사: ${input.articleId}`);
  if (input.userRole) contextLines.push(`사용자 역할: ${input.userRole}`);
  if (input.toolsUsed?.length) contextLines.push(`조회 Tool: ${input.toolsUsed.join(", ")}`);
  if (input.toolResults && Object.keys(input.toolResults).length > 0) {
    contextLines.push(`DB 조회 결과:\n${JSON.stringify(input.toolResults, null, 2)}`);
  }

  if (contextLines.length > 0) {
    messages.push({
      role: "user",
      content: `[세션 컨텍스트]\n${contextLines.join("\n")}`,
    });
    messages.push({
      role: "assistant",
      content: "컨텍스트와 DB 조회 결과를 확인했습니다. 질문에 답변하겠습니다.",
    });
  }

  for (const turn of input.history ?? []) {
    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: turn.text,
    });
  }

  messages.push({ role: "user", content: input.message });
  return messages;
}

export function extractAssistantText(data: {
  choices?: { message?: { content?: string | null } }[];
}): string | null {
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || null;
}
