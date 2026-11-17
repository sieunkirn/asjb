import type { LucideIcon } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "excel";
type ButtonSize = "sm" | "md" | "lg";

const variantCls: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover shadow-sm focus-visible:ring-brand/40",
  secondary: "bg-card border border-border text-foreground hover:border-brand/40 hover:text-brand focus-visible:ring-brand/30",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-brand/20 hover:shadow-none",
  danger: "bg-danger text-white hover:bg-danger-hover shadow-sm focus-visible:ring-danger/40",
  success: "bg-success text-white hover:bg-success-hover shadow-sm focus-visible:ring-success/40",
  excel: "bg-[#217346] text-white hover:bg-[#1a5c38] shadow-sm focus-visible:ring-[#217346]/40 border border-[#1a5c38]",
};

const sizeCls: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5 rounded-lg",
  md: "px-4 py-2.5 text-sm gap-2 rounded-xl",
  lg: "px-5 py-3 text-sm gap-2 rounded-xl",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  loading = false,
  className = "",
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-45 disabled:pointer-events-none cursor-pointer hover:scale-[1.02] hover:shadow-sm active:scale-[0.98] ${variantCls[variant]} ${sizeCls[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === "sm" ? 13 : 15} className={loading ? "animate-spin" : undefined} />}
      {children}
    </button>
  );
}
