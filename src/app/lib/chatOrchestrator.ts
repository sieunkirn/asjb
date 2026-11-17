import type { ChatMessage, UserRole } from "../types";
import type { ChatQueryContext } from "./chatEngine";
import { extractSearchQuery, findPersonName, parseArticleId, resolveChatResponse } from "./chatEngine";
import { filterActionsByRole } from "./chatPermissions";
import { executeChatTool, inferChatTools, type ChatToolContext, type ChatToolName } from "./chatTools";

export type ChatProviderMode = "rule" | "llm";

export interface OrchestratedChatResponse {
  body: Omit<ChatMessage, "role" | "timestamp">;
  toolsUsed: ChatToolName[];
  toolResults: Record<string, unknown>;
  provider: ChatProviderMode;
}

function buildToolArgs(
  tool: ChatToolName,
  ctx: ChatQueryContext,
): Record<string, unknown> {
  const args: Record<string, unknown> = { editionId: ctx.editionId };
  if (tool === "get_article") {
    args.articleId = ctx.articleId ?? parseArticleId(ctx.message, ctx.articles);
  }
  if (tool === "get_person_articles") {
    // 기사의 작성자·실천자 이름과 대조해 이름을 뽑음 (기존 [가-힣]{2,4} 추정은 오탐이 많음)
    const name = findPersonName(ctx.message, ctx.articles);
    if (name) args.name = name;
  }
  if (tool === "search_articles") {
    args.query = extractSearchQuery(ctx.message);
  }
  return args;
}

export function runChatTools(
  toolsUsed: ChatToolName[],
  ctx: ChatQueryContext,
): Record<string, unknown> {
  const toolCtx: ChatToolContext = {
    editionId: ctx.editionId,
    articles: ctx.articles,
    editions: ctx.editions,
  };
  const results: Record<string, unknown> = {};
  for (const tool of toolsUsed) {
    results[tool] = executeChatTool(tool, buildToolArgs(tool, ctx), toolCtx);
  }
  return results;
}

export function orchestrateChat(
  ctx: ChatQueryContext & { userRole?: UserRole },
  provider: ChatProviderMode = "rule",
): OrchestratedChatResponse {
  const toolsUsed = inferChatTools(ctx.message, {
    editionId: ctx.editionId,
    articles: ctx.articles,
    editions: ctx.editions,
    articleId: ctx.articleId,
  });

  const toolResults = runChatTools(toolsUsed, ctx);
  const raw = resolveChatResponse(ctx);
  const role = ctx.userRole ?? "reviewer";
  const actions = filterActionsByRole(raw.actions, role);

  return {
    body: {
      ...raw,
      actions: actions.length ? actions : undefined,
      meta: { toolsUsed, provider },
    },
    toolsUsed,
    toolResults,
    provider,
  };
}
