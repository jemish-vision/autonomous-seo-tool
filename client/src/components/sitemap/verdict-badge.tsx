import { cn } from "@/lib/cn";
import type { AiAccessVerdict } from "@/lib/data-sitefiles";

const VERDICT_LABEL: Record<AiAccessVerdict, string> = {
  allowed: "Allowed",
  "partly-blocked": "Partly blocked",
  blocked: "Blocked",
  "ignores-robots": "Ignores robots.txt",
  unknown: "Unknown",
};

const VERDICT_CLASS: Record<AiAccessVerdict, string> = {
  allowed: "bg-ok-bg text-ok",
  "partly-blocked": "bg-warn-bg text-warn",
  blocked: "bg-danger-bg text-danger",
  "ignores-robots": "bg-data-violet/10 text-data-violet",
  unknown: "bg-subtle text-faint",
};

export function verdictLabel(v: AiAccessVerdict): string {
  return VERDICT_LABEL[v];
}

export function VerdictBadge({ verdict, className }: { verdict: AiAccessVerdict; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-control px-2 py-0.5 text-xs font-medium", VERDICT_CLASS[verdict], className)}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
