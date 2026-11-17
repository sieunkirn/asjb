import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react";
import {
  type ExtractedArticle } from "../../api/scoring";
import {
  reviewReasonLabel } from "../../lib/scoringLabels";
import { Card } from "../ui/Card";
import { DataTable, TH_CLS } from "../ui/DataTable";
import { EmptyState } from "../ui/Feedback";
import { Badge } from "./ui";

export function ArticlesTable({
  articles, extracting, expandedId, onToggle,
}: {
  articles: ExtractedArticle[];
  extracting: boolean;
  expandedId: number | null;
  onToggle: (id: number) => void;
}) {
  if (articles.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={extracting ? Loader2 : FileText}
          title={extracting ? "기사를 추출하는 중입니다" : "표시할 기사가 없습니다"}
          description={extracting ? "페이지별로 추출이 끝나는 대로 목록에 추가됩니다." : "필터를 해제하거나 다른 문서를 선택해 보세요."}
        />
      </Card>
    );
  }

  return (
    <DataTable>
      <thead className="bg-muted/50 border-b border-border">
        <tr>
          <th className={`${TH_CLS} w-8`} />
          <th className={`${TH_CLS} w-16`}>페이지</th>
          <th className={TH_CLS}>제목</th>
          <th className={TH_CLS}>작성자</th>
          <th className={TH_CLS}>실천자</th>
          <th className={TH_CLS}>본문</th>
          <th className={`${TH_CLS} w-32`}>추출 확인</th>
        </tr>
      </thead>
      <tbody>
        {articles.map(a => {
          const open = expandedId === a.id;
          return (
            <ArticleRowGroup key={a.id} open={open} onToggle={() => onToggle(a.id)} article={a} />
          );
        })}
      </tbody>
    </DataTable>
  );
}

function ArticleRowGroup({ article: a, open, onToggle }: { article: ExtractedArticle; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-border cursor-pointer transition-colors ${open ? "bg-accent/40" : "hover:bg-muted/40"}`}
      >
        <td className="px-3 py-3 text-muted-foreground">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.source_page ?? "-"}</td>
        <td className="px-4 py-3 text-sm font-medium text-foreground max-w-[220px] truncate">{a.title || <span className="text-muted-foreground">(제목 없음)</span>}</td>
        <td className="px-4 py-3 text-sm">{a.writer || "-"}</td>
        <td className="px-4 py-3 text-sm">{a.target || "-"}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[280px] truncate">{a.content || "-"}</td>
        <td className="px-4 py-3">
          {a.needs_review
            ? <Badge tone="warning"><AlertTriangle size={11} /> 기술 확인</Badge>
            : <Badge tone="success"><CheckCircle2 size={11} /> 이상 없음</Badge>}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-muted/20">
          <td />
          <td colSpan={6} className="px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">기사 본문</div>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{a.content || "(본문 없음)"}</p>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">기사 ID</div>
                  <div className="text-xs font-mono">{a.id}</div>
                </div>
                {a.review_reasons.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">확인 사유</div>
                    <ul className="text-xs text-amber-800 space-y-0.5">
                      {a.review_reasons.map(r => <li key={r}>· {reviewReasonLabel(r)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── 채점 결과 ───────────────────────────────────────────────────────────────
