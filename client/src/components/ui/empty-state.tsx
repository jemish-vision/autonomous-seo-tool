import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong bg-subtle px-6 py-12 text-center", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-control bg-elevated border border-border">
        <Icon size={20} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <div className="max-w-md text-xs text-secondary">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
