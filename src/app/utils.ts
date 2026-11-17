export { exportArticlesToExcel } from "./lib/excelExport";

import { ALLOWED_SCORES } from "./lib/scoreUtils";

export { ALLOWED_SCORES, nearestAllowedScore } from "./lib/scoreUtils";

/**
 * 투표 최빈값. 0점 투표도 센다. 동점이면 높은 점수(기존 규칙 유지).
 * 허용 점수 외 값은 무시하며, 유효 투표가 없으면 0.
 */
export function modeScore(votes: number[]): number {
  let best = 0;
  let bestCount = 0;
  for (const s of ALLOWED_SCORES) {
    const count = votes.filter(v => v === s).length;
    if (count > 0 && count >= bestCount) {
      best = s;
      bestCount = count;
    }
  }
  return best;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
