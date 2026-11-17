import type { Edition } from "../types";

export interface EditionMonthGroup {
  month: string;
  weeks: { week: number; label: string; editions: Edition[] }[];
}

/** 호수 목록을 발행월 → 주차별로 그룹화 */
export function groupEditionsByMonthWeek(editions: Edition[]): EditionMonthGroup[] {
  const monthMap = new Map<string, Map<number, Edition[]>>();

  for (const ed of editions) {
    const month = ed.month?.trim() || "미분류";
    const week = ed.week ?? 1;
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    const weekMap = monthMap.get(month)!;
    if (!weekMap.has(week)) weekMap.set(week, []);
    weekMap.get(week)!.push(ed);
  }

  return [...monthMap.entries()]
    .sort(([a], [b]) => compareMonthDesc(a, b))
    .map(([month, weekMap]) => ({
      month,
      weeks: [...weekMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([week, list]) => ({
          week,
          label: `${week}주차`,
          editions: [...list].sort((a, b) => a.id - b.id),
        })),
    }));
}

/** "2024년 1월" → 202401. 파싱 실패 시 null */
function monthSortKey(month: string): number | null {
  const m = month.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

/** 최신 월이 먼저 오도록 내림차순 비교. 숫자 파싱이 되면 숫자로(10월>2월 보장), 안 되면 문자열로 비교 */
function compareMonthDesc(a: string, b: string): number {
  const ka = monthSortKey(a);
  const kb = monthSortKey(b);
  if (ka != null && kb != null) return kb - ka;
  if (ka != null) return -1; // 파싱 안 되는 값("미분류" 등)은 뒤로
  if (kb != null) return 1;
  return b.localeCompare(a, "ko");
}
