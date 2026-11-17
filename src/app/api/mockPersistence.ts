const STORAGE_KEY = "bredred-mock-store-v1";

export interface PersistedMockState {
  editions: unknown[];
  articles: unknown[];
  uploads: unknown[];
  auditLogs: unknown[];
  notifications: unknown[];
}

export function loadPersistedState(): PersistedMockState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedMockState;
    if (!Array.isArray(parsed.editions) || !Array.isArray(parsed.articles)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedMockState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded 등 — 무시
  }
}

export function clearPersistedState(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
