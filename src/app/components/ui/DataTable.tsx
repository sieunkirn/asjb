export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tabs.map(tab => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
              isActive
                ? "bg-brand text-white border-brand shadow-sm"
                : "bg-card text-muted-foreground border-border hover:border-brand/30 hover:text-brand"
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-muted"}`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ProgressBar({
  value,
  done = false,
  className = "",
}: {
  value: number;
  done?: boolean;
  className?: string;
}) {
  return (
    <div className={`w-full bg-muted rounded-full h-1.5 overflow-hidden ${className}`}>
      <div
        className={`h-1.5 rounded-full transition-all duration-500 ${done ? "bg-emerald-500" : "bg-brand"}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export const TH_CLS = "text-left px-4 py-3.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap";

export function DataTable({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-2xl border border-border overflow-hidden shadow-sm ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">{children}</table>
      </div>
    </div>
  );
}
