import { ArrowLeftRight, XCircle } from "lucide-react";
import type { Article } from "../types";
import { ScoreDots, StatusTag } from "./common";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function DuplicateComparePanel({
  current,
  partner,
  onKeepCurrent,
  onKeepPartner,
  onExcludePartner,
  loading,
}: {
  current: Article;
  partner: Article;
  onKeepCurrent: () => void;
  onKeepPartner: () => void;
  onExcludePartner: () => void;
  loading?: boolean;
}) {
  return (
    <Card padding="md" className="border-amber-200/80 bg-amber-50/50">
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight size={16} className="text-amber-700" />
        <span className="text-sm font-semibold text-amber-800">중복 의심 — 나란히 비교</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {[current, partner].map(a => (
          <div key={a.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">{a.id}</span>
              <StatusTag status={a.status} />
            </div>
            <div className="text-sm font-medium">{a.subject} · {a.department}</div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{a.basis}</p>
            <ScoreDots score={a.aiScore} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onKeepCurrent} disabled={loading}>
          {current.id} 유지
        </Button>
        <Button size="sm" variant="secondary" onClick={onKeepPartner} disabled={loading}>
          {partner.id} 유지
        </Button>
        <Button size="sm" variant="ghost" icon={XCircle} onClick={onExcludePartner} disabled={loading} className="text-red-600 hover:bg-red-50">
          상대 기사 중복 제외
        </Button>
      </div>
    </Card>
  );
}
