import type { Edition } from "../types";

export function formatEditionMonth(date = new Date()): string {
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
}

/** 목록에 없는 selectedEdition을 최신 호수로 보정 */
export function reconcileSelectedEdition(editions: Edition[], current: number): number {
  if (editions.some(e => e.id === current)) return current;
  const sorted = [...editions].sort((a, b) => b.id - a.id);
  return sorted[0]?.id ?? current;
}
