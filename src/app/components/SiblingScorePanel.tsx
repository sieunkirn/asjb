import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import type { Article } from "../types";
import { articlesApi } from "../api";
import { reviewerName } from "../api/auth";
import { ALLOWED_SCORES } from "../utils";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

/** "1810-2" → 2 (실천자 순번), 접미사가 없으면 0 */
const suffixOf = (id: string): number => {
  const dash = id.indexOf("-");
  return dash === -1 ? 0 : parseInt(id.slice(dash + 1), 10) || 0;
};

/**
 * 실천자별 점수 일괄 확정 패널 (검수 상세)
 * ────────────────────────────────────────
 * 한 기사에 실천자가 여러 명이면(행 id "1810-1", "1810-2" …) 목록을 오가지 않고
 * 이 패널에서 실천자마다 점수를 입력해 개별 또는 한 번에 확정한다.
 */
export function SiblingScorePanel({
  article,
  allInEdition,
  setArticles,
  onConfirmed,
}: {
  article: Article;
  allInEdition: Article[];
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>;
  onConfirmed?: () => void;
}) {
  const baseId = article.id.split("-")[0];
  const siblings = useMemo(
    () =>
      allInEdition
        .filter(a => a.id === baseId || a.id.startsWith(`${baseId}-`))
        .sort((a, b) => suffixOf(a.id) - suffixOf(b.id)),
    [allInEdition, baseId],
  );

  const [scores, setScores] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string[]>([]);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (siblings.length <= 1) return null;

  const scoreOf = (a: Article): string =>
    scores[a.id] ?? String(a.finalScore ?? a.aiScore);

  /** flagReason의 "기업 확인 시 N점 후보" 힌트 추출 */
  const candidateOf = (a: Article): number | null => {
    const m = a.flagReason?.match(/기업 확인 시 (\d+(?:\.\d+)?)점 후보/);
    return m ? Number(m[1]) : null;
  };

  const parseScore = (a: Article): number | null => {
    const n = Number(scoreOf(a));
    return (ALLOWED_SCORES as readonly number[]).includes(n) ? n : null;
  };

  const confirmOne = async (a: Article): Promise<boolean> => {
    const score = parseScore(a);
    if (score == null) {
      setError(`${a.subject}: 점수는 0, 1, 2, 4, 5점 중 하나여야 합니다.`);
      return false;
    }
    setSaving(prev => [...prev, a.id]);
    setError(null);
    try {
      const updated = await articlesApi.confirm(a.id, {
        finalScore: score,
        votes: [],
        isRereview: a.finalScore != null,
        reviewer: reviewerName(),
      });
      setArticles(prev => prev.map(x => (x.id === updated.id ? updated : x)));
      onConfirmed?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : `${a.subject} 확정에 실패했습니다.`);
      return false;
    } finally {
      setSaving(prev => prev.filter(id => id !== a.id));
    }
  };

  const confirmAll = async () => {
    setSavingAll(true);
    setError(null);
    for (const a of siblings) {
      if (a.status === "중복 제외") continue;
      // 이미 확정됐고 점수를 바꾸지 않은 행은 다시 확정하지 않는다 (검수 이력 중복 방지)
      if (a.status === "승인" && a.finalScore != null && parseScore(a) === a.finalScore) continue;
      const ok = await confirmOne(a);
      if (!ok) break;
    }
    setSavingAll(false);
  };

  const pendingCount = siblings.filter(a => a.status === "재확인 필요").length;

  return (
    <Card padding="md">
      <div className="text-xs font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Users size={12} />실천자별 점수 확정 ({siblings.length}명)
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        이 기사의 실천자 {siblings.length}명을 여기서 한 번에 확정할 수 있습니다.
        {pendingCount > 0 && <> · 재확인 대기 <span className="font-semibold text-amber-700">{pendingCount}명</span></>}
      </p>

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {siblings.map(a => {
          const isCurrent = a.id === article.id;
          const confirmed = a.status === "승인" && a.finalScore != null;
          const excluded = a.status === "중복 제외";
          const candidate = candidateOf(a);
          const busy = saving.includes(a.id);
          return (
            <div
              key={a.id}
              className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
                isCurrent ? "border-brand/40 bg-accent/40" : "border-border bg-card"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground truncate" title={a.subject}>
                  {a.subject}
                  {a.department !== "미기재" && <span className="text-muted-foreground font-normal"> · {a.department}</span>}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  AI {a.aiScore}점{candidate != null && ` · 검토 후 ${candidate}점 후보`}
                  {excluded && " · 중복 제외"}
                </div>
              </div>
              {confirmed && !busy && <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />}
              <select
                value={scoreOf(a)}
                onChange={e => setScores(prev => ({ ...prev, [a.id]: e.target.value }))}
                disabled={excluded || busy || savingAll}
                className="w-16 px-2 py-1 rounded-lg border border-border bg-card text-xs font-mono text-right focus:outline-none focus:border-brand"
                aria-label={`${a.subject} 최종 점수`}
              >
                {/* AI 점수가 허용 목록에 없으면(예: 0.5) 그대로 보여주되 확정은 막힘 */}
                {!(ALLOWED_SCORES as readonly number[]).includes(Number(scoreOf(a))) && (
                  <option value={scoreOf(a)}>{scoreOf(a)}</option>
                )}
                {ALLOWED_SCORES.map(s => (
                  <option key={s} value={String(s)}>{s}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant={confirmed ? "ghost" : "secondary"}
                disabled={excluded || busy || savingAll}
                loading={busy}
                icon={busy ? Loader2 : undefined}
                onClick={() => void confirmOne(a)}
              >
                {confirmed ? "수정" : "확정"}
              </Button>
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}

      <Button
        className="w-full mt-3"
        disabled={savingAll || saving.length > 0}
        loading={savingAll}
        icon={savingAll ? Loader2 : CheckCircle2}
        onClick={() => void confirmAll()}
      >
        {savingAll ? "확정 중..." : "입력한 점수로 전체 확정"}
      </Button>
    </Card>
  );
}
