import type { ChatMessage } from "../types";
import type { SendChatPayload } from "../api/types";
import { API_BASE } from "../api/client";
import type { OrchestratedChatResponse } from "./chatOrchestrator";

function chatCompletionsUrl(): string {
  return API_BASE ? `${API_BASE}/api/chat/completions` : "/api/chat/completions";
}

/**
 * LLM 백엔드 호출.
 * - dev: Vite 플러그인 `/api/chat/completions` (OPENAI_API_KEY)
 * - prod: VITE_API_BASE_URL 백엔드 동일 엔드포인트
 * 실패 시 null → rule orchestrator 폴백
 */
export async function tryLlmChat(
  payload: SendChatPayload,
  orchestrated: OrchestratedChatResponse,
): Promise<Omit<ChatMessage, "role" | "timestamp"> | null> {
  const provider = import.meta.env.VITE_CHAT_PROVIDER;
  if (provider !== "llm") return null;

  try {
    const res = await fetch(chatCompletionsUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: payload.message,
        editionId: payload.editionId,
        page: payload.page,
        articleId: payload.articleId,
        history: payload.history,
        userRole: payload.userRole,
        llmContext: payload.llmContext ?? {
          toolsUsed: orchestrated.toolsUsed,
          toolResults: orchestrated.toolResults,
        },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      text?: string;
      table?: ChatMessage["table"];
      links?: ChatMessage["links"];
      actions?: ChatMessage["actions"];
      meta?: ChatMessage["meta"];
    };

    if (!data.text?.trim()) return null;

    return {
      text: data.text,
      table: data.table ?? orchestrated.body.table,
      links: data.links ?? orchestrated.body.links,
      actions: data.actions ?? orchestrated.body.actions,
      meta: {
        toolsUsed: orchestrated.toolsUsed,
        provider: "llm",
        ...data.meta,
      },
    };
  } catch {
    return null;
  }
}

export function isLlmProviderEnabled(): boolean {
  return import.meta.env.VITE_CHAT_PROVIDER === "llm";
}
