/** 확정 가능한 점수 (0 · 1 · 2 · 4 · 5) */
export const ALLOWED_SCORES = [0, 1, 2, 4, 5] as const;

/**
 * 임의의 점수를 가장 가까운 허용 점수로 맞춘다 (예: 3 → 2). 같은 거리면 낮은 점수.
 * 반올림(Math.round)만 쓰면 3점처럼 존재하지 않는 점수가 제안될 수 있다.
 */
export function nearestAllowedScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let best: number = ALLOWED_SCORES[0];
  let bestDistance = Math.abs(value - best);
  for (const s of ALLOWED_SCORES) {
    const d = Math.abs(value - s);
    if (d < bestDistance) {
      best = s;
      bestDistance = d;
    }
  }
  return best;
}
