import { describe, expect, it } from "vitest";
import { computeEditionSync } from "./editionSync";
import type { Article, UploadedFile } from "../types";

const baseArticle = (edition: number, status: Article["status"] = "승인"): Article => ({
  id: "A-1",
  edition,
  author: "a",
  subject: "b",
  department: "생산팀",
  aiScore: 4,
  status,
  date: "2024-01-01",
});

describe("computeEditionSync", () => {
  it("기사가 있고 재확인 필요하면 검수 중", () => {
    const result = computeEditionSync({
      editionId: 907,
      articles: [baseArticle(907, "재확인 필요")],
      uploads: [],
      isProtectedEdition: true,
    });
    expect(result.status).toBe("검수 중");
    expect(result.articleCount).toBe(1);
    expect(result.removeFromList).toBe(false);
  });

  it("모든 기사가 승인/중복제외면 완료", () => {
    const result = computeEditionSync({
      editionId: 906,
      articles: [baseArticle(906, "승인"), baseArticle(906, "중복 제외")],
      uploads: [],
      isProtectedEdition: true,
    });
    expect(result.status).toBe("완료");
  });

  it("기사·업로드 없고 보호되지 않은 호수는 제거", () => {
    const result = computeEditionSync({
      editionId: 909,
      articles: [],
      uploads: [],
      isProtectedEdition: false,
    });
    expect(result.status).toBe("업로드 대기");
    expect(result.removeFromList).toBe(true);
  });

  it("진행 중 업로드만 있으면 검수 중", () => {
    const uploads: UploadedFile[] = [{
      id: "u-1",
      name: "x.pdf",
      size: 100,
      progress: 50,
      stage: "analyzing",
      edition: 908,
    }];
    const result = computeEditionSync({
      editionId: 908,
      articles: [],
      uploads,
      isProtectedEdition: true,
    });
    expect(result.status).toBe("검수 중");
    expect(result.removeFromList).toBe(false);
  });
});
