import type { ChatAction, ChatMessage } from "../types";

import type { SendChatPayload } from "./types";

import { api, apiCall } from "./client";

import { mockStore } from "./mockStore";

export const chatApi = {
  getPreset: (editionId?: number) =>
    apiCall(
      () => mockStore.getPresetChat(editionId),
      () => api.get<ChatMessage[]>(editionId != null ? `/api/chat/preset?edition=${editionId}` : "/api/chat/preset"),
    ),

  getBriefing: (editionId?: number) =>
    apiCall(
      () => mockStore.getProactiveBriefing(editionId),
      () => api.get<ChatMessage | null>(editionId != null ? `/api/chat/briefing?edition=${editionId}` : "/api/chat/briefing"),
    ),

  send: (payload: SendChatPayload) =>
    apiCall(
      () => mockStore.sendChat(payload),
      () => api.post<ChatMessage>("/api/chat", payload),
    ),

  logAction: (action: ChatAction) =>
    apiCall(
      () => mockStore.recordChatAction(action),
      () => api.post<void>("/api/chat/actions", action),
    ),
};
