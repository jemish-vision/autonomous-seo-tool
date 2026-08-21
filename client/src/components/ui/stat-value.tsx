import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  value: ReactNode;
  caption?: ReactNode;
  size?: "card" | "hero";
  className?: string;
}

export function StatValue({ value, caption, size = "card", className }: Props) {
  return (
    <div className={className}>
      <div className={cn("font-semibold tabular-nums text-foreground", size === "hero" ? "text-[28px] leading-tight" : "text-2xl leading-tight")}>
        {value}
      </div>
      {caption && <div className="mt-1 text-xs text-faint">{caption}</div>}
    </div>
  );
}
