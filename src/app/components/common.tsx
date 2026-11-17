import { AlertTriangle, CheckCircle2, Star, XCircle } from "lucide-react";
import type { Status } from "../types";

// ─── 상태 태그 ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<Status, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  "승인": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200/80", icon: <CheckCircle2 size={12} /> },
  "재확인 필요": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200/80", icon: <AlertTriangle size={12} /> },
  "중복 제외": { bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200", icon: <XCircle size={12} /> },
};

/** 화면 표시용 짧은 상태 라벨 (데이터 값은 그대로, 표시만 축약) */
const STATUS_SHORT: Record<Status, string> = {
  "승인": "승인",
  "재확인 필요": "재확인",
  "중복 제외": "중복 제외",
};

export function StatusTag({ status, size = "sm" }: { status: Status; size?: "sm" | "md" }) {
  const cfg = STATUS_CFG[status];
  const sizeCls = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium border whitespace-nowrap ${sizeCls} ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {STATUS_SHORT[status]}
    </span>
  );
}

// ─── 별점 표시 ────────────────────────────────────────────────────────────────

export function ScoreDots({ score, size = "sm" }: { score: number; size?: "sm" | "md" }) {
  const rounded = Math.round(score);
  const starSize = size === "md" ? 14 : 11;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={starSize}
          className={i <= rounded ? "fill-brand text-brand" : "text-border-strong"}
        />
      ))}
      <span className="ml-1.5 text-xs font-mono text-muted-foreground tabular-nums">{score.toFixed(1)}</span>
    </div>
  );
}

// ─── 확인 다이얼로그 ──────────────────────────────────────────────────────────

export function ConfirmDialog({
  open, title, message, confirmLabel = "삭제", tone = "danger", onConfirm, onCancel, loading = false,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  if (!open) return null;
  const confirmCls = tone === "danger"
    ? "bg-danger hover:bg-danger-hover"
    : "bg-brand hover:bg-brand-hover";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tone === "danger" ? "bg-red-50" : "bg-accent"}`}>
              <AlertTriangle size={18} className={tone === "danger" ? "text-danger" : "text-brand"} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">{title}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{message}</div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-50 ${confirmCls}`}
          >
            {loading ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
