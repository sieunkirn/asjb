import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "./Button";

export interface DropdownOption {
  value: string;
  label: string;
}

export function DropdownSelect({
  value,
  onChange,
  options,
  size = "sm",
  align = "left",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  size?: "sm" | "md";
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);

  return (
    <div className={`relative ${className}`}>
      <Button variant="secondary" size={size} onClick={() => setOpen(o => !o)}>
        {current?.label ?? value}
        <ChevronDown size={14} className={`ml-0.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            className={`absolute mt-1.5 min-w-[9rem] max-h-64 overflow-y-auto bg-card rounded-xl border border-border shadow-lg z-20 ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3.5 py-2.5 text-sm hover:bg-muted transition-colors ${
                  value === opt.value ? "text-brand bg-accent font-medium" : ""
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
