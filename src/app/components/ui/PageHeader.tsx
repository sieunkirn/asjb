import type { LucideIcon } from "lucide-react";

export function PageHeader({
  title,
  description,
  badge,
  action,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
          {badge}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon: Icon,
  onClick,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "default" | "success" | "warning" | "muted";
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  const tones = {
    default: { value: "text-foreground", bg: "bg-card" },
    success: { value: "text-emerald-600", bg: "bg-emerald-50/80 border-emerald-100" },
    warning: { value: "text-amber-600", bg: "bg-amber-50/80 border-amber-100" },
    muted: { value: "text-slate-500", bg: "bg-card" },
  }[tone];

  const inner = (
    <div className="flex items-start justify-between">
      <div>
        <div className={`text-3xl font-semibold font-mono tabular-nums ${tones.value}`}>{value}</div>
        <div className="text-sm font-medium text-foreground mt-1.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
      {Icon && (
        <div className="w-9 h-9 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground group-hover:text-brand transition-colors">
          <Icon size={18} />
        </div>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`rounded-2xl border border-border shadow-sm p-5 text-left w-full cursor-pointer hover:shadow-md hover:border-brand/30 active:scale-[0.99] transition-all duration-200 ${tones.bg} group`}
      >
        {inner}
      </button>
    );
  }

  return (
    <Card className={`${tones.bg} group`} padding="md" hover>
      {inner}
    </Card>
  );
}

function Card({ children, className, padding, hover }: {
  children: React.ReactNode;
  className?: string;
  padding?: "md";
  hover?: boolean;
}) {
  const pad = padding === "md" ? "p-5" : "";
  const hoverCls = hover ? "hover:shadow-md hover:border-brand/15 transition-all duration-200" : "";
  return (
    <div className={`rounded-2xl border border-border shadow-sm ${pad} ${hoverCls} ${className ?? ""}`}>
      {children}
    </div>
  );
}
