import { describe, expect, it } from "vitest";
import { modeScore } from "./utils";

describe("modeScore", () => {
  it("0점 투표는 0점으로 확정된다", () => {
    expect(modeScore([0])).toBe(0);
    expect(modeScore([0, 0, 0])).toBe(0);
  });

  it("0점이 다수면 0점", () => {
    expect(modeScore([0, 0, 1])).toBe(0);
  });

  it("최빈값을 고른다", () => {
    expect(modeScore([2, 4, 4])).toBe(4);
    expect(modeScore([5, 1, 1])).toBe(1);
  });

  it("동점이면 높은 점수", () => {
    expect(modeScore([2, 4])).toBe(4);
    expect(modeScore([0, 1])).toBe(1);
  });

  it("투표가 없으면 0", () => {
    expect(modeScore([])).toBe(0);
  });

  it("허용되지 않는 점수(3)는 무시한다", () => {
    expect(modeScore([3, 3, 2])).toBe(2);
  });
});

import { nearestAllowedScore } from "./lib/scoreUtils";

describe("nearestAllowedScore", () => {
  it("허용 점수는 그대로", () => {
    for (const s of [0, 1, 2, 4, 5]) expect(nearestAllowedScore(s)).toBe(s);
  });

  it("존재하지 않는 점수(3, 2.5 등)는 가장 가까운 허용 점수로, 같은 거리면 낮은 쪽", () => {
    expect(nearestAllowedScore(3)).toBe(2);
    expect(nearestAllowedScore(3.4)).toBe(4);
    expect(nearestAllowedScore(1.5)).toBe(1);
    expect(nearestAllowedScore(4.6)).toBe(5);
    expect(nearestAllowedScore(-1)).toBe(0);
    expect(nearestAllowedScore(99)).toBe(5);
  });

  it("숫자가 아니면 0", () => {
    expect(nearestAllowedScore(NaN)).toBe(0);
  });
});
