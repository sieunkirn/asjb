import { useMemo } from "react";
import { useApp } from "../context/AppContext";
import { sortArticles } from "../lib/articleFilters";
import { ReviewDetail } from "./review/ReviewDetail";
import { ReviewList } from "./review/ReviewList";


export function ReviewPage({
  selectedId, setSelectedId, onBackToList,
}: {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onBackToList: () => void;
}) {
  const { articles, setArticles, selectedEdition } = useApp();
  const editionArticles = useMemo(
    () => articles.filter(a => a.edition === selectedEdition),
    [articles, selectedEdition],
  );
  const article = selectedId ? editionArticles.find(a => a.id === selectedId) ?? articles.find(a => a.id === selectedId) ?? null : null;

  if (article) {
    return (
      <ReviewDetail
        key={article.id}
        article={article}
        queue={sortArticles(editionArticles.filter(a => a.status === "재확인 필요" || a.id === article.id), "priority")}
        allInEdition={editionArticles}
        setArticles={setArticles}
        onBack={onBackToList}
        onNavigate={setSelectedId}
      />
    );
  }
  return <ReviewList articles={editionArticles} onOpen={setSelectedId} />;
}
