import type { Page, ChatHistoryTurn, UserRole } from "../types";

export interface ConfirmArticlePayload {
  finalScore: number;
  votes: number[];
  isRereview?: boolean;
  /** 검수자 이름 (DB 모드에서 검수 이력에 기록) */
  reviewer?: string;
}

export interface ExcludeDuplicatePayload {
  keepId: string;
  excludeId: string;
  reviewer?: string;
}

export interface SendChatPayload {
  message: string;
  editionId?: number;
  page?: Page;
  articleId?: string;
  history?: ChatHistoryTurn[];
  userRole?: UserRole;
  llmContext?: {
    toolsUsed?: string[];
    toolResults?: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

