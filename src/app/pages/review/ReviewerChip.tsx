import { useState } from "react";
import { reviewerName, setReviewerName } from "../../api/auth";

export function ReviewerChip() {
  const [name, setName] = useState(reviewerName());
  return (
    <button
      type="button"
      onClick={() => {
        const next = window.prompt("검수자 이름을 입력하세요 (검수 이력에 기록됩니다)", name);
        if (next && next.trim()) {
          setReviewerName(next);
          setName(next.trim());
        }
      }}
      className="text-xs text-muted-foreground hover:text-brand px-2 py-1 rounded-lg hover:bg-muted transition-colors cursor-pointer"
      title="검수자 이름 변경"
    >
      검수자: {name} ✎
    </button>
  );
}
