import {
  AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2, RotateCcw, Sparkles } from "lucide-react";
import {
  type ArticleEvaluation, type EvaluationSummary } from "../../api/scoring";
import {
  confidenceLabel, evaluationStatusLabel, evaluationSummaryStatusLabel, isEvaluationFinished, practitionerScoreText, reviewReasonLabel, scoreTypeLabel, summarizeEvaluations, warningLabel } from "../../lib/scoringLabels";
import { StatCard } from "../ui/PageHeader";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { DataTable, ProgressBar, TH_CLS } from "../ui/DataTable";
import { EmptyState } from "../ui/Feedback";
import { Badge, evaluationTone } from "./ui";
import { formatDateTime } from "./helpers";

export function EvaluationsSection({
  summary, evaluations, totals, running, extractionReady, reevaluating, expandedId, onToggle, onReevaluate,
}: {
  summary: EvaluationSummary | null;
  evaluations: ArticleEvaluation[];
  totals: ReturnType<typeof summarizeEvaluations>;
  running: boolean;
  extractionReady: boolean;
  reevaluating: number[];
  expandedId: number | null;
  onToggle: (id: number) => void;
  onReevaluate: (id: number) => void;
}) {
  const notStarted = !summary || summary.status === "not_ready" || summary.status === "pending";

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-xl px-4 py-2.5 flex items-start gap-2">
        <Sparkles size={13} className="text-brand mt-0.5 flex-shrink-0" />
        <span>
          <span className="font-medium text-foreground">자동 확정</span>: 4번 유형 2점 · 5번 유형 1점 · 점수제외 0점 &nbsp;/&nbsp;
          <span className="font-medium text-foreground">기업 검토 필요</span>: 1번·2번·기타내용 유형 후보 (자동 확정하지 않음) &nbsp;/&nbsp;
          작성자 점수는 이번 버전에서 자동 계산하지 않습니다.
        </span>
      </div>

      {summary && !notStarted && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="채점 완료" value={`${summary.done}/${summary.total}`} sub="기사 기준" tone="default" />
            <StatCard label="자동 확정 점수 합계" value={totals.autoScoreTotal} sub={`실천자 ${totals.practitionerCount}명`} tone="success" />
            <StatCard label="기업 검토 필요" value={summary.needs_review} sub={`실천자 ${totals.reviewPractitionerCount}명`} tone="warning" />
            <StatCard label="오류" value={summary.error} sub={summary.error > 0 ? "재평가로 다시 시도" : "없음"} tone={summary.error > 0 ? "warning" : "muted"} />
          </div>
          <Card padding="md" className="!p-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {running && <Loader2 size={12} className="text-brand animate-spin" />}
                <Badge tone={running ? "brand" : isEvaluationFinished(summary.status) ? (summary.error > 0 ? "warning" : "success") : "neutral"}>
                  {evaluationSummaryStatusLabel(summary.status)}
                </Badge>
                <span>대기 {summary.pending} · 진행 {summary.processing} · 완료 {summary.done} · 오류 {summary.error}</span>
              </span>
              <span className="font-mono font-semibold tabular-nums text-muted-foreground">{summary.progress_percent}%</span>
            </div>
            <ProgressBar value={summary.progress_percent} done={summary.status === "completed"} />
          </Card>
        </>
      )}

      {notStarted && !running ? (
        <Card padding="none">
          <EmptyState
            icon={Sparkles}
            title={extractionReady ? "아직 점수화하지 않았습니다" : "기사 추출이 끝나면 점수화할 수 있습니다"}
            description={extractionReady
              ? "위의 ‘점수화 시작’ 버튼을 누르면 추출된 모든 기사를 실천자별로 채점합니다. 기사 수에 따라 수 분에서 수십 분 걸릴 수 있습니다."
              : "추출 진행률이 100%가 되면 ‘점수화 시작’ 버튼이 활성화됩니다."}
          />
        </Card>
      ) : evaluations.length === 0 ? (
        <Card padding="none">
          <EmptyState icon={FileText} title="표시할 채점 결과가 없습니다" description="필터를 해제하거나 잠시 후 다시 확인해 주세요." />
        </Card>
      ) : (
        <DataTable>
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className={`${TH_CLS} w-8`} />
              <th className={`${TH_CLS} w-16`}>페이지</th>
              <th className={TH_CLS}>기사</th>
              <th className={TH_CLS}>실천자별 결과</th>
              <th className={`${TH_CLS} w-24`}>상태</th>
              <th className={`${TH_CLS} w-24`} />
            </tr>
          </thead>
          <tbody>
            {evaluations.map(ev => (
              <EvaluationRowGroup
                key={ev.article_id}
                evaluation={ev}
                open={expandedId === ev.article_id}
                busy={reevaluating.includes(ev.article_id) || ev.status === "processing"}
                disabled={running}
                onToggle={() => onToggle(ev.article_id)}
                onReevaluate={() => onReevaluate(ev.article_id)}
              />
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}

function EvaluationRowGroup({
  evaluation: ev, open, busy, disabled, onToggle, onReevaluate,
}: {
  evaluation: ArticleEvaluation;
  open: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onReevaluate: () => void;
}) {
  const results = ev.practitioner_results ?? [];
  const raw = ev.raw_result;

  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-border cursor-pointer transition-colors align-top ${open ? "bg-accent/40" : ev.evaluation_needs_review ? "bg-amber-50/40 hover:bg-amber-50/70" : "hover:bg-muted/40"}`}
      >
        <td className="px-3 py-3 text-muted-foreground">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{ev.source_page ?? "-"}</td>
        <td className="px-4 py-3 max-w-[240px]">
          <div className="text-sm font-medium text-foreground truncate">{ev.title || <span className="text-muted-foreground">(제목 없음)</span>}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{ev.writer || "-"} → {ev.target || "-"}</div>
        </td>
        <td className="px-4 py-3">
          {ev.status === "done" && results.length > 0 ? (
            <ul className="space-y-1.5">
              {results.map((r, i) => (
                <li key={`${r.person_name}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium text-foreground">{r.person_name}</span>
                  {r.practitioner_department && <span className="text-muted-foreground">({r.practitioner_department})</span>}
                  <Badge tone={r.needs_review ? "warning" : r.score_type === "EXCLUDED" ? "neutral" : "success"}>
                    {scoreTypeLabel(r.score_type)}
                  </Badge>
                  <span className={`font-mono font-semibold tabular-nums ${r.needs_review ? "text-amber-700" : "text-foreground"}`}>
                    {practitionerScoreText(r)}
                  </span>
                  {r.score_label && <span className="text-muted-foreground">· {r.score_label}</span>}
                </li>
              ))}
            </ul>
          ) : ev.status === "error" ? (
            <span className="text-xs text-red-700 line-clamp-2">{ev.error_message || "채점 중 오류가 발생했습니다."}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{ev.status === "processing" ? "채점 중…" : "대기 중"}</span>
          )}
          {ev.status === "done" && ev.quality_warnings.length > 0 && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              ⚠ {ev.quality_warnings.map(warningLabel).join(" · ")}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          <Badge tone={evaluationTone(ev.status)}>
            {(busy || ev.status === "processing") && <Loader2 size={10} className="animate-spin" />}
            {busy && ev.status !== "processing" ? "재평가 요청" : evaluationStatusLabel(ev.status)}
          </Badge>
          {ev.evaluation_needs_review && (
            <div className="mt-1"><Badge tone="warning"><AlertTriangle size={10} /> 기업 검토</Badge></div>
          )}
        </td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            icon={busy ? Loader2 : RotateCcw}
            loading={busy}
            disabled={disabled || busy}
            onClick={onReevaluate}
            title="이 기사만 다시 채점"
          >
            재평가
          </Button>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-border bg-muted/20">
          <td />
          <td colSpan={5} className="px-4 py-4 space-y-4">
            {raw?.article_action_summary && (
              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">실천 내용 요약</div>
                <p className="text-sm text-foreground leading-relaxed">{raw.article_action_summary}</p>
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-3">
                {results.map((r, i) => (
                  <div key={`${r.person_name}-detail-${i}`} className={`rounded-xl border p-3 ${r.needs_review ? "border-amber-200 bg-amber-50/50" : "border-border bg-card"}`}>
                    <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                      <span className="text-sm font-semibold text-foreground">{r.person_name}</span>
                      {r.practitioner_department && <span className="text-muted-foreground">{r.practitioner_department}</span>}
                      <Badge tone={r.needs_review ? "warning" : "success"}>{scoreTypeLabel(r.score_type)}</Badge>
                      <span className="font-mono font-semibold">{practitionerScoreText(r)}</span>
                      <span className="text-muted-foreground">규칙 {r.rule_id || "미지정"}{r.matched_rule ? ` · ${r.matched_rule}` : ""}</span>
                      <span className="text-muted-foreground">신뢰도 {confidenceLabel(r.confidence)}</span>
                    </div>
                    <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[90px_1fr]">
                      {r.basis_item_or_action && (<><dt className="text-muted-foreground">실천 내용</dt><dd className="text-foreground">{r.basis_item_or_action}</dd></>)}
                      <dt className="text-muted-foreground">기사 원문 근거</dt>
                      <dd className="text-foreground whitespace-pre-wrap">“{r.evidence}”</dd>
                      <dt className="text-muted-foreground">판정 사유</dt>
                      <dd className="text-foreground whitespace-pre-wrap">{r.reason}</dd>
                      {r.review_reasons.length > 0 && (
                        <>
                          <dt className="text-muted-foreground">검토 사유</dt>
                          <dd className="text-amber-800">{r.review_reasons.map(reviewReasonLabel).join(", ")}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
              <span>기사 ID {ev.article_id}</span>
              {ev.model && <span>모델 {ev.model}</span>}
              {raw?.overall_confidence && <span>전체 신뢰도 {confidenceLabel(raw.overall_confidence)}</span>}
              {ev.evaluated_at && <span>평가 {formatDateTime(ev.evaluated_at)}</span>}
              {ev.article_needs_review && (
                <span className="text-amber-700">추출 단계 확인 필요: {ev.article_review_reasons.map(reviewReasonLabel).join(", ")}</span>
              )}
            </div>
            {ev.status === "error" && ev.error_message && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 whitespace-pre-wrap">{ev.error_message}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
