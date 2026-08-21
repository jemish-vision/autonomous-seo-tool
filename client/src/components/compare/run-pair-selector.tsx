import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, ChevronDown, ArrowLeftRight } from "lucide-react";
import type { RunListItem } from "@/lib/data";
import { cn } from "@/lib/cn";
import { hostnameFor, formatRunTimestamp } from "@/components/shell/run-label";

/** One custom dropdown (not a native <select>) — reused for both the base and head pickers. */
function RunPicker({ label, runs, selectedId, onChoose }: { label: string; runs: RunListItem[]; selectedId: string | null; onChoose: (runId: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = runs.find((r) => r.runId === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex w-full sm:w-72 items-center gap-1.5 rounded-control border border-border bg-subtle px-3 py-2 text-left text-xs font-medium text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Calendar size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="truncate" title={selected?.runId}>
          {selected ? `${hostnameFor(selected.startUrl)} · ${formatRunTimestamp(selected.startedAt)}` : "Pick a run…"}
        </span>
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" className="ml-auto shrink-0" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-[calc(100%+4px)] z-20 max-h-72 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-control border border-border bg-elevated py-1 shadow-popover"
        >
          {runs.map((run) => (
            <li key={run.runId}>
              <button
                type="button"
                role="option"
                aria-selected={run.runId === selectedId}
                onClick={() => {
                  setOpen(false);
                  onChoose(run.runId);
                }}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition-colors duration-150 hover:bg-subtle",
                  run.runId === selectedId && "bg-subtle",
                )}
              >
                <span className="font-medium text-foreground">{hostnameFor(run.startUrl)}</span>
                <span className="text-faint">
                  {formatRunTimestamp(run.startedAt)} · {run.coveragePercent}% coverage · {run.successful} pages
                </span>
                <span className="text-faint/70">{run.runId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Base + head run pickers, reflected into ?base=&head= — the compare view is shareable and
 * back/forward-safe (design-dna-v2 Law 1). */
export function RunPairSelector({ runs, baseRunId, headRunId }: { runs: RunListItem[]; baseRunId: string | null; headRunId: string | null }) {
  const goTo = useNavigate();

  function navigate(base: string | null, head: string | null) {
    const params = new URLSearchParams();
    if (base) params.set("base", base);
    if (head) params.set("head", head);
    goTo(`/compare?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <RunPicker label="Base (before)" runs={runs} selectedId={baseRunId} onChoose={(id) => navigate(id, headRunId)} />
      <button
        type="button"
        onClick={() => navigate(headRunId, baseRunId)}
        disabled={!baseRunId || !headRunId}
        aria-label="Swap base and head"
        className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-border bg-subtle text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50"
      >
        <ArrowLeftRight size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <RunPicker label="Head (after)" runs={runs} selectedId={headRunId} onChoose={(id) => navigate(baseRunId, id)} />
    </div>
  );
}
