import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, History, Keyboard, Pencil, RotateCcw, ThumbsUp, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import type { AuditLogEntry } from "../../types";
import { articlesApi } from "../../api";
import { enrichReviewContent, type EnrichedReviewContent } from "../../lib/reviewContent";
import { getDuplicatePartner } from "../../lib/articleFilters";
import { modeScore } from "../../utils";
import { ScoreDots, StatusTag } from "../../components/common";
import { reviewerName } from "../../api/auth";
import { ARTICLES_FROM_DB, scoringDb } from "../../api/scoringDb";
import { DuplicateComparePanel } from "../../components/DuplicateComparePanel";
import { SiblingScorePanel } from "../../components/SiblingScorePanel";
import { AuditTimeline } from "../../components/AuditTimeline";
import { ScoreTypeGuide } from "../../components/ScoreTypeGuide";
import { ErrorBanner, LoadingState } from "../../components/ui/Feedback";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ReviewerChip } from "./ReviewerChip";

/** 사랑평가 유효 점수 — 자동 0·1·2점, 기업 확인 후 4·5점 (3점 없음) */
const VOTE_SCORES = [0, 1, 2, 4, 5];

export function ReviewDetail({
  article, queue, allInEdition, setArticles, onBack, onNavigate,
}: {
  article: import("../../types").Article;
  queue: import("../../types").Article[];
  allInEdition: import("../../types").Article[];
  setArticles: React.Dispatch<React.SetStateAction<import("../../types").Article[]>>;
  onBack: () => void;
  onNavigate: (id: string | null) => void;
}) {
  const [content, setContent] = useState<EnrichedReviewContent | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(120);
  const [votes, setVotes] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [dupLoading, setDupLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const partnerId = getDuplicatePartner(article);
  const partner = partnerId ? allInEdition.find(a => a.id === partnerId) ?? null : null;
  const alreadyConfirmed = article.status === "승인" && article.finalScore != null;
  const [editing, setEditing] = useState(!alreadyConfirmed);
  const [confirmedScore, setConfirmedScore] = useState<number | null>(alreadyConfirmed ? article.finalScore! : null);

  // 회차 간 이력 — 같은 실천자가 다른 기사(다른 호수)에서 점수받은 기록
  const [history, setHistory] = useState<import("../../types").Article[] | null>(null);
  useEffect(() => {
    if (!ARTICLES_FROM_DB || !article.subject || article.subject === "-") {
      setHistory([]);
      return;
    }
    let cancelled = false;
    scoringDb.practitionerHistory(article.subject, article.id)
      .then(rows => { if (!cancelled) setHistory(rows); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [article.id, article.subject]);

  const queueIdx = queue.findIndex(a => a.id === article.id);
  const prevId = queueIdx > 0 ? queue[queueIdx - 1].id : null;
  const nextId = queueIdx >= 0 && queueIdx < queue.length - 1 ? queue[queueIdx + 1].id : null;

  const loadContent = useCallback(async () => {
    setContentLoading(true);
    setContentError(null);
    try {
      const [raw, logs] = await Promise.all([
        articlesApi.getReview(article.id),
        articlesApi.getAuditLogs(article.id),
      ]);
      setContent(enrichReviewContent(raw));
      setAuditLogs(logs);
    } catch {
      setContentError("검수 데이터를 불러오지 못했습니다.");
    } finally {
      setContentLoading(false);
    }
  }, [article.id]);

  useEffect(() => { loadContent(); }, [loadContent]);

  const avg = votes.length ? (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1) : null;
  const finalMode = modeScore(votes);

  // 연타·키 반복으로 같은 확정 요청이 여러 번 가지 않도록 동기적으로 막는다
  const confirmingRef = useRef(false);

  const confirm = useCallback(async () => {
    if (votes.length === 0 || !editing || confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    try {
      const updated = await articlesApi.confirm(article.id, { finalScore: finalMode, votes, isRereview: confirmedScore != null, reviewer: reviewerName() });
      setArticles(prev => prev.map(a => (a.id === article.id ? updated : a)));
      setConfirmedScore(finalMode);
      setEditing(false);
      const logs = await articlesApi.getAuditLogs(article.id);
      setAuditLogs(logs);
    } catch (e) {
      setConfirmError(e instanceof Error && e.message ? e.message : "점수 확정에 실패했습니다.");
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }, [votes, editing, article.id, finalMode, confirmedScore, setArticles]);

  const handleExcludeDuplicate = useCallback(async (keepId: string, excludeId: string) => {
    setDupLoading(true);
    setConfirmError(null);
    try {
      const [kept, excluded] = await articlesApi.excludeDuplicate({ keepId, excludeId, reviewer: reviewerName() });
      setArticles(prev => prev.map(a => {
        if (a.id === kept.id) return kept;
        if (a.id === excluded.id) return excluded;
        return a;
      }));
      if (article.id === excludeId) onNavigate(keepId);
      const logs = await articlesApi.getAuditLogs(article.id);
      setAuditLogs(logs);
    } catch (e) {
      setConfirmError(e instanceof Error && e.message ? e.message : "중복 제외 처리에 실패했습니다.");
    } finally {
      setDupLoading(false);
    }
  }, [article.id, setArticles, onNavigate]);

  // 이 기사가 다른 곳(실천자별 패널 · 챗봇)에서 확정·수정되면 투표 패널 상태도 따라간다
  // (그대로 두면 이미 확정된 점수를 '처음 확정'으로 다시 보내게 된다)
  useEffect(() => {
    if (confirmingRef.current) return;
    if (article.status === "승인" && article.finalScore != null) {
      setConfirmedScore(article.finalScore);
      setEditing(false);
    }
  }, [article.status, article.finalScore]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+P(인쇄) 등 브라우저 단축키, 키를 꾹 눌러 생기는 반복 입력은 무시
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (
        t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement
        || (t instanceof HTMLElement && t.isContentEditable)
      ) return;
      // 버튼에 포커스가 있을 때 Enter/Space는 그 버튼의 동작(클릭)에 맡긴다
      if (t instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
      if (["0", "1", "2", "4", "5"].includes(e.key) && editing) { setVotes(v => [...v, +e.key]); return; }
      if (e.key === "Enter" && editing && votes.length) { e.preventDefault(); confirm(); return; }
      if (e.key === "n" && nextId) onNavigate(nextId);
      if (e.key === "p" && prevId) onNavigate(prevId);
      if (e.key === "?") setShowShortcuts(s => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, votes.length, confirm, nextId, prevId, onNavigate]);

  if (contentLoading) return <div className="flex-1 flex items-center justify-center"><LoadingState message="검수 데이터 로딩..." /></div>;
  if (contentError || !content) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
        <ErrorBanner message={contentError ?? "오류"} onRetry={loadContent} />
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>목록</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b bg-card flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} />목록</button>
          <span className="text-sm font-semibold">{article.id}</span>
          <StatusTag status={article.status} size="md" />
          <ReviewerChip />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowShortcuts(s => !s)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="단축키" aria-label="단축키 보기"><Keyboard size={15} /></button>
          {prevId && <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => onNavigate(prevId)}>이전</Button>}
          {nextId && <Button variant="ghost" size="sm" onClick={() => onNavigate(nextId)}>다음<ArrowRight size={14} className="ml-1" /></Button>}
        </div>
      </div>

      {showShortcuts && (
        <div className="px-4 py-2 bg-muted/50 border-b text-[11px] text-muted-foreground flex flex-wrap gap-4">
          <span><kbd className="px-1 bg-card rounded border">0·1·2·4·5</kbd> 투표</span>
          <span><kbd className="px-1 bg-card rounded border">Enter</kbd> 확정</span>
          <span><kbd className="px-1 bg-card rounded border">N</kbd> 다음</span>
          <span><kbd className="px-1 bg-card rounded border">P</kbd> 이전</span>
        </div>
      )}

      {article.flagReason && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200/80 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} />{article.flagReason}
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(400px,0.95fr)] overflow-hidden">
        <div className="flex flex-col border-b lg:border-b-0 lg:border-r overflow-hidden min-h-[240px]">
          <div className="px-4 py-2.5 border-b bg-muted/30 flex justify-between items-center">
            <span className="text-xs font-semibold text-muted-foreground uppercase">원본 · 성심당 사보</span>
            <div className="flex gap-1">
              <button onClick={() => setZoom(z => Math.max(70, z - 10))} className="p-1.5 rounded-lg hover:bg-muted" aria-label="축소"><ZoomOut size={13} /></button>
              <span className="text-xs font-mono w-10 text-center pt-1.5">{zoom}%</span>
              <button onClick={() => setZoom(z => Math.min(220, z + 10))} className="p-1.5 rounded-lg hover:bg-muted" aria-label="확대"><ZoomIn size={13} /></button>
              <button onClick={() => setZoom(120)} className="p-1.5 rounded-lg hover:bg-muted"><RotateCcw size={13} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-[#E8E0D8] flex justify-center p-4">
            <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center", transition: "transform 0.2s" }}>
              <div className="w-[min(440px,88vw)] bg-[#FDFBF8] border border-[#D4C8BC] rounded-lg shadow-lg overflow-hidden">
                <div className="bg-[#2C1A0E] text-[#F7EEE8] text-center py-3 text-sm font-semibold tracking-[0.35em]">성 심 당 사 보</div>
                <div className="p-5 space-y-2">
                  <div className="text-xs text-center text-[#8A7060]">{article.edition}호 · 사랑기사란</div>
                  <div className="border-t border-[#DDD0C8] pt-3">
                    <div className="text-base font-bold mb-2">{content.title}</div>
                    <div className="text-[13px] leading-[1.85] text-[#3C2A1E]">{content.body}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t max-h-32 overflow-auto px-4 py-3 text-xs font-mono bg-card whitespace-pre-line">{content.ocr}</div>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {partner && (
            <DuplicateComparePanel
              current={article}
              partner={partner}
              loading={dupLoading}
              onKeepCurrent={() => partner && handleExcludeDuplicate(article.id, partner.id)}
              onKeepPartner={() => partner && handleExcludeDuplicate(partner.id, article.id)}
              onExcludePartner={() => partner && handleExcludeDuplicate(article.id, partner.id)}
            />
          )}

          {confirmedScore != null && (
            <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-4">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-xs font-semibold text-emerald-700 mb-1 flex items-center gap-1"><CheckCircle2 size={12} />확정 점수</div>
                  <ScoreDots score={confirmedScore} size="md" />
                </div>
                {!editing && (
                  <Button variant="secondary" size="sm" icon={History} onClick={() => { setEditing(true); setVotes([]); }} className="border-emerald-300 text-emerald-700">
                    재검수
                  </Button>
                )}
              </div>
              {editing && <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1"><Pencil size={11} />재검수 모드</p>}
            </div>
          )}

          <Card padding="md">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-3">인식 정보</div>
            {content.recognized.map(row => (
              <div key={row.label} className="grid grid-cols-[auto_1fr] gap-x-6 items-center text-sm py-2 border-b border-border/60 last:border-0">
                <span className="flex items-center gap-1.5 text-muted-foreground shrink-0 min-w-[4.5rem]">{row.icon}{row.label}</span>
                <span className="font-medium text-right whitespace-nowrap min-w-[5rem]">{row.value}</span>
              </div>
            ))}
          </Card>

          <Card padding="md">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase">AI 제안</span>
              <span className="text-xs text-muted-foreground">신뢰도 {content.confidence}%</span>
            </div>
            <ScoreDots score={article.aiScore} size="md" />
            <div className="mt-2 h-1.5 bg-muted rounded-full"><div className="h-full bg-brand rounded-full" style={{ width: `${content.confidence}%` }} /></div>
          </Card>

          {history && history.length > 0 && (
            <Card padding="md">
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                <History size={12} />회차 간 이력 — {article.subject}
              </div>
              <p className="text-[11px] text-amber-700 mb-2">
                이 실천자의 다른 기사 기록입니다. 같은 실천 내용의 중복 여부를 확인해 주세요.
              </p>
              <ul className="space-y-1.5">
                {history.slice(0, 5).map(h => (
                  <li key={h.id} className="flex items-center justify-between gap-2 text-xs">
                    <button type="button" onClick={() => onNavigate(h.id)} className="text-brand hover:underline cursor-pointer">
                      {h.edition ? `${h.edition}호` : "호수 미지정"} · {h.date || "-"}
                    </button>
                    <span className="flex items-center gap-1.5">
                      <StatusTag status={h.status} />
                      <span className="font-mono tabular-nums">{(h.finalScore ?? h.aiScore).toFixed(1)}점</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <SiblingScorePanel
            article={article}
            allInEdition={allInEdition}
            setArticles={setArticles}
            onConfirmed={() => { articlesApi.getAuditLogs(article.id).then(setAuditLogs).catch(() => {}); }}
          />

          <Card padding="md">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-3 flex items-center gap-1"><ThumbsUp size={12} />다수결 투표</div>
            <div className="flex gap-2 mb-3">
              {VOTE_SCORES.map(s => (
                <button key={s} onClick={() => editing && setVotes(v => [...v, s])} disabled={!editing}
                  className={`flex-1 py-3 rounded-xl border text-sm font-semibold ${!editing ? "opacity-50" : "hover:border-brand hover:bg-accent active:scale-95"}`}>{s}</button>
              ))}
            </div>
            {votes.length > 0 && (
              <p className="text-xs text-muted-foreground mb-3">{votes.length}표 · 평균 {avg} · 다수결 <strong className="text-brand">{finalMode}</strong></p>
            )}
            {confirmError && <p className="text-xs text-red-600 mb-2">{confirmError}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={confirm} disabled={!votes.length || !editing || confirming} loading={confirming} icon={confirming ? Loader2 : undefined}>
                {confirming ? "확정 중..." : confirmedScore != null && editing ? "수정 확정" : "점수 확정"}
              </Button>
              <Button variant="ghost" onClick={() => setVotes([])} disabled={!editing}>초기화</Button>
            </div>
          </Card>

          <Card padding="md">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-3">검수 이력</div>
            <AuditTimeline logs={auditLogs} compact />
          </Card>

          <ScoreTypeGuide />
        </div>
      </div>
    </div>
  );
}
