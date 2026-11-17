import { CheckCircle2, History, Upload, UserCog, XCircle } from "lucide-react";
import type { AuditLogEntry } from "../types";

/** chat_action은 타임라인에 표시하지 않으므로 의도적으로 키를 정의하지 않음 (아래 filter + !cfg 가드 참고) */
const ACTION_CFG: Partial<Record<AuditLogEntry["action"], { icon: React.ReactNode; label: string; color: string }>> = {
  confirm: { icon: <CheckCircle2 size={13} />, label: "점수 확정", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  "re-review": { icon: <History size={13} />, label: "재검수", color: "text-blue-600 bg-blue-50 border-blue-200" },
  exclude_duplicate: { icon: <XCircle size={13} />, label: "중복 제외", color: "text-slate-600 bg-slate-100 border-slate-200" },
  upload: { icon: <Upload size={13} />, label: "업로드", color: "text-violet-600 bg-violet-50 border-violet-200" },
  relation_update: { icon: <UserCog size={13} />, label: "관계 변경", color: "text-rose-600 bg-rose-50 border-rose-200" },
};

export function AuditTimeline({ logs, compact = false }: { logs: AuditLogEntry[]; compact?: boolean }) {
  const visibleLogs = logs.filter(l => l.action !== "chat_action");
  if (visibleLogs.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">아직 이력이 없습니다.</p>;
  }

  return (
    <div className={`space-y-0 ${compact ? "" : "pl-1"}`}>
      {visibleLogs.map((log, i) => {
        const cfg = ACTION_CFG[log.action];
        if (!cfg) return null;
        const time = new Date(log.timestamp).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return (
          <div key={log.id} className="flex gap-3 relative">
            {i < visibleLogs.length - 1 && (
              <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
            )}
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
              {cfg.icon}
            </div>
            <div className={`pb-4 flex-1 min-w-0 ${compact ? "pb-3" : ""}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">{cfg.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{time}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{log.detail}</p>
              <span className="text-[10px] text-muted-foreground/70">{log.userName}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
