import { buildLlmMessages, extractAssistantText } from "../src/app/lib/llmPrompt";
import { buildDemoLlmReply } from "../src/app/lib/llmDemoReply";

export interface ChatCompletionBody {
  message: string;
  editionId?: number;
  page?: string;
  articleId?: string;
  history?: { role: "user" | "ai"; text: string }[];
  userRole?: string;
  llmContext?: {
    toolsUsed?: string[];
    toolResults?: Record<string, unknown>;
  };
}

export interface LlmEnvConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getLlmConfig(env: Record<string, string>): LlmEnvConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env.OPENAI_MODEL || "gpt-4o-mini",
  };
}

export async function completeChat(
  body: ChatCompletionBody,
  config: LlmEnvConfig,
): Promise<{ text: string }> {
  const messages = buildLlmMessages({
    message: body.message,
    editionId: body.editionId,
    page: body.page,
    articleId: body.articleId,
    history: body.history?.map(h => ({ role: h.role, text: h.text })),
    userRole: body.userRole,
    toolsUsed: body.llmContext?.toolsUsed,
    toolResults: body.llmContext?.toolResults,
  });

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: 900,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM API 오류 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as Parameters<typeof extractAssistantText>[0];
  const text = extractAssistantText(data);
  if (!text) throw new Error("LLM 응답이 비어 있습니다.");
  return { text };
}

/** OPENAI_API_KEY 없을 때 — Tool 결과로 자연어 데모 응답 */
export function completeChatDemo(body: ChatCompletionBody): { text: string; demo: true } {
  return {
    text: buildDemoLlmReply({
      message: body.message,
      editionId: body.editionId,
      articleId: body.articleId,
      llmContext: body.llmContext,
    }),
    demo: true,
  };
}
