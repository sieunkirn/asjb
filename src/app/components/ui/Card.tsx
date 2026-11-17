export function Card({
  children,
  className = "",
  padding = "md",
  hover = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  hover?: boolean;
  onClick?: () => void;
}) {
  const pad = { none: "", sm: "p-4", md: "p-5", lg: "p-6" }[padding];
  const interactive = onClick ? "cursor-pointer" : "";
  const hoverCls = hover || onClick ? "hover:shadow-md hover:border-brand/20 transition-all duration-200" : "";

  return (
    <div
      onClick={onClick}
      className={`bg-card rounded-2xl border border-border shadow-sm ${pad} ${hoverCls} ${interactive} ${className}`}
    >
      {children}
    </div>
  );
}

