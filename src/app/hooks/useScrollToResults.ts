import { useEffect, useRef } from "react";

/** 검색어 변경 시 결과 영역으로 부드럽게 스크롤 */
export function useScrollToResults(query: string, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(query);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !trimmed || trimmed === prev.current.trim()) return;
    const timer = setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    prev.current = query;
    return () => clearTimeout(timer);
  }, [query, enabled]);

  return ref;
}
