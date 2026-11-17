import { useCallback, useEffect, useState } from "react";
import type { Page } from "../types";

export interface HashRoute {
  page: Page;
  articleId: string | null;
}

function parseHash(): HashRoute {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [segment, ...rest] = raw.split("/");
  const validPages: Page[] = ["dashboard", "upload", "review", "scores", "editions"];
  // 이전 주소 안내: #/scoring → 업로드 탭, #/employees(예전 '사원 관리') → 실천자 점수 탭
  const legacy: Record<string, string> = { scoring: "upload", employees: "scores" };
  const normalized = legacy[segment] ?? segment;
  const page = validPages.includes(normalized as Page) ? (normalized as Page) : "dashboard";
  const articleId = page === "review" && rest[0] ? rest[0] : null;
  return { page, articleId };
}

function buildHash(page: Page, articleId?: string | null): string {
  if (page === "review" && articleId) return `#/review/${articleId}`;
  return `#/${page}`;
}

export function useHashRoute() {
  const [route, setRouteState] = useState<HashRoute>(parseHash);

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash());
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) window.location.hash = "#/dashboard";
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((page: Page, articleId?: string | null) => {
    const next = buildHash(page, articleId);
    if (window.location.hash !== next) window.location.hash = next;
    setRouteState({ page, articleId: articleId ?? null });
  }, []);

  return { route, navigate };
}
