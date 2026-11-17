import type { ReviewContent } from "../types";
import { Briefcase, Building2, User } from "lucide-react";
import { createElement } from "react";

export type EnrichedReviewContent = Omit<ReviewContent, "recognized"> & {
  recognized: { label: string; value: string; icon: React.ReactNode }[];
};

/** API 응답 ReviewContent에 UI 아이콘을 추가 */
export function enrichReviewContent(content: ReviewContent): EnrichedReviewContent {
  const iconMap: Record<string, React.ReactNode> = {
    작성자: createElement(User, { size: 13 }),
    실천자: createElement(User, { size: 13 }),
    부서: createElement(Building2, { size: 13 }),
    직위: createElement(Briefcase, { size: 13 }),
  };
  return {
    ...content,
    recognized: content.recognized.map(r => ({
      ...r,
      icon: iconMap[r.label] ?? createElement(User, { size: 13 }),
    })),
  };
}
