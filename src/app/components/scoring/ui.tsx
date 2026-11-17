/** 분석 · 채점 화면에서 함께 쓰는 작은 UI 조각 */
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

const TONE_CLS: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 border-slate-200",
  brand: "bg-accent text-brand border-brand/20",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  warning: "bg-amber-50 text-amber-700 border-amber-200/80",
  danger: "bg-red-50 text-red-700 border-red-200/80",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium border px-2 py-0.5 text-[11px] whitespace-nowrap ${TONE_CLS[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function extractionTone(status: string): Tone {
  if (status === "completed") return "success";
  if (status === "completed_with_errors") return "warning";
  if (status === "failed") return "danger";
  return "brand";
}

export function evaluationTone(status: string): Tone {
  if (status === "done") return "success";
  if (status === "error") return "danger";
  if (status === "processing") return "brand";
  return "neutral";
}

export function Toggle({ checked, onChange, label, count }: { checked: boolean; onChange: (v: boolean) => void; label: string; count?: number }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-[var(--brand)]" />
      <span>{label}</span>
      {count != null && <span className="font-mono tabular-nums px-1.5 py-0.5 rounded-full bg-muted text-[10px]">{count}</span>}
    </label>
  );
}
