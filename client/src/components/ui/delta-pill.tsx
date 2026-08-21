import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  direction: "up" | "down" | "neutral";
  label: string;
  className?: string;
}

const CONFIG = {
  up: { icon: ArrowUp, classes: "bg-ok-bg text-ok" },
  down: { icon: ArrowDown, classes: "bg-danger-bg text-danger" },
  neutral: { icon: Minus, classes: "bg-subtle text-secondary" },
} as const;

/** Icon + text always together — color alone never carries the meaning. */
export function DeltaPill({ direction, label, className }: Props) {
  const { icon: Icon, classes } = CONFIG[direction];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium tabular-nums", classes, className)}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
