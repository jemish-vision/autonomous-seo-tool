import { Loader2, CheckCircle2, XCircle, Ban } from "lucide-react";
import { cn } from "@/lib/cn";

type ChipState = "starting" | "running" | "done" | "failed" | "cancelled";

const CONFIG: Record<ChipState, { label: string; classes: string }> = {
  starting: { label: "Starting", classes: "bg-primary/10 text-primary" },
  running: { label: "Running", classes: "bg-primary/10 text-primary" },
  done: { label: "Done", classes: "bg-ok-bg text-ok" },
  failed: { label: "Failed", classes: "bg-danger-bg text-danger" },
  cancelled: { label: "Cancelled", classes: "bg-subtle text-secondary" },
};

export function StatusChip({ state }: { state: ChipState }) {
  const { label, classes } = CONFIG[state];
  const active = state === "starting" || state === "running";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium", classes)}>
      {active ? (
        <Loader2 size={12} strokeWidth={2.5} className="animate-spin" aria-hidden="true" />
      ) : state === "done" ? (
        <CheckCircle2 size={12} strokeWidth={2.5} aria-hidden="true" />
      ) : state === "cancelled" ? (
        <Ban size={12} strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <XCircle size={12} strokeWidth={2.5} aria-hidden="true" />
      )}
      {label}
      {active && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
      )}
    </span>
  );
}
