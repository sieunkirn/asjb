import { describe, expect, it } from "vitest";
import { reconcileSelectedEdition } from "./editionUtils";
import type { Edition } from "../types";

describe("reconcileSelectedEdition", () => {
  const editions: Edition[] = [
    { id: 908, label: "908호", month: "2월", status: "업로드 대기", articleCount: 0 },
    { id: 907, label: "907호", month: "1월", status: "검수 중", articleCount: 10 },
  ];

  it("목록에 있으면 그대로 유지", () => {
    expect(reconcileSelectedEdition(editions, 907)).toBe(907);
  });

  it("목록에 없으면 최신 호수로 전환", () => {
    expect(reconcileSelectedEdition(editions, 909)).toBe(908);
  });
});
