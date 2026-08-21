import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  dot?: "danger" | "warn" | "ok";
}

const DOT_CLASSES = { danger: "bg-danger", warn: "bg-warn", ok: "bg-ok" };

export function Chip({ active, dot, className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors duration-150",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        active
          ? "border-primary bg-primary text-primary-contrast"
          : "border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[dot])} aria-hidden="true" />}
      {children}
    </button>
  );
}
