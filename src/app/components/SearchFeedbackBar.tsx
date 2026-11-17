import { X } from "lucide-react";

export interface SearchFeedback {
  count: number;
  total: number;
  entityLabel: string;
  applicable: boolean;
  hint?: string;
}

export function SearchFeedbackBar({
  query,
  feedback,
  onClear,
}: {
  query: string;
  feedback: SearchFeedback;
  onClear: () => void;
}) {
  if (!query.trim()) return null;

  return (
    <div className="border-b border-brand/20 bg-accent/70 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
      {feedback.applicable ? (
        <p className="text-base text-foreground min-w-0">
          <span className="font-bold text-brand">&quot;{query.trim()}&quot;</span>
          {" "}검색 —{" "}
          <span className="font-bold text-lg text-brand">{feedback.count}건</span>
          {feedback.total !== feedback.count && (
            <span className="text-muted-foreground text-sm"> / 전체 {feedback.total}건</span>
          )}
          <span className="text-muted-foreground text-sm"> {feedback.entityLabel}</span>
          {feedback.count === 0 && (
            <span className="text-muted-foreground text-sm"> · 조건에 맞는 결과가 없습니다</span>
          )}
        </p>
      ) : (
        <p className="text-base text-muted-foreground min-w-0">
          {feedback.hint ?? "이 페이지에서는 검색이 적용되지 않습니다"}
        </p>
      )}
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 flex-shrink-0 text-sm font-medium text-muted-foreground hover:text-brand px-3 py-1.5 rounded-xl border border-border bg-card hover:border-brand/30 transition-colors"
      >
        <X size={14} />
        검색 지우기
      </button>
    </div>
  );
}
