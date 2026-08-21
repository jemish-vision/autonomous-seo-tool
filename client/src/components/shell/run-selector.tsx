import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Calendar, ChevronDown } from "lucide-react";
import type { RunListItem } from "@/lib/data";
import { pickDefaultRun } from "@/lib/run-selection";
import { cn } from "@/lib/cn";
import { hostnameFor, formatRunTimestamp } from "./run-label";
import { AnalyzeNowButton } from "@/components/analyze-now-button";

/** Global (shell-level) custom dropdown (not a native <select>) — chip trigger + a focus-trapped
 * listbox. Rendered by Topbar on every data route so a selected run survives navigation. */
export function RunSelector({ runs }: { runs: RunListItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();

  // Same rule as lib/data.ts resolveRunId(): valid ?run= wins, otherwise pickDefaultRun decides.
  const requested = searchParams.get("run");
  const current = (requested && runs.find((r) => r.runId === requested)) || pickDefaultRun(runs);

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

  function choose(runId: string) {
    setOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("run", runId);
    navigate(`${pathname}?${params.toString()}`);
  }

  if (!current) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${current.runId} (${current.startUrl})`}
        className="inline-flex items-center gap-1 sm:gap-1.5 rounded-pill border border-border-strong bg-elevated px-2 sm:px-3 py-1.5 text-xs font-medium text-foreground shadow-card transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-w-[110px] min-[400px]:max-w-[150px] sm:max-w-none"
      >
        <HealthDot score={current.healthScore} analyzed={current.analyzed} />
        <Calendar size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="truncate">
          <span className="font-semibold">{hostnameFor(current.startUrl)}</span>
          <span className="hidden md:inline text-faint"> · {formatRunTimestamp(current.startedAt)}</span>
        </span>
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Select crawl run"
          // Right-anchored: the trigger sits at the viewport's right edge, so a left-anchored
          // panel overflowed and clipped the coverage/page counts.
          className="absolute right-0 top-[calc(100%+4px)] z-20 max-h-72 w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-control border border-border bg-elevated py-1 shadow-popover"
        >
          {runs.map((run) => (
            <li
              key={run.runId}
              className={cn("flex items-center gap-1 pl-3 pr-2", run.runId === current.runId && "bg-subtle")}
            >
              <button
                type="button"
                role="option"
                aria-selected={run.runId === current.runId}
                onClick={() => choose(run.runId)}
                title={run.runId}
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2 text-left text-xs transition-colors duration-150"
              >
                <span className="w-full truncate font-medium text-foreground">{hostnameFor(run.startUrl)}</span>
                <span className="w-full truncate text-faint">
                  {formatRunTimestamp(run.startedAt)} · {run.coveragePercent}% coverage · {run.successful} pages
                  {run.analyzed && run.healthScore !== null && run.healthScore !== undefined ? (
                    <span className="ml-1 font-medium">· health {run.healthScore}</span>
                  ) : !run.analyzed ? (
                    <span className="ml-1 rounded-pill bg-warn-bg px-1 py-px text-[10px] font-medium text-warn">not analyzed</span>
                  ) : null}
                </span>
              </button>
              {!run.analyzed && (
                <AnalyzeNowButton
                  runId={run.runId}
                  label="Analyze"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onComplete={() => setOpen(false)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tiny health dot on the selector — green/amber/red from the run's own health score, grey when
 *  unanalyzed. Pure signal, no invented color: same token idiom as the rest of the app. */
function HealthDot({ score, analyzed }: { score: number | null | undefined; analyzed?: boolean }) {
  if (!analyzed || score === null || score === undefined) {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-faint" aria-hidden="true" title="Not analyzed" />;
  }
  const tone = score >= 80 ? "bg-ok" : score >= 50 ? "bg-warn" : "bg-danger";
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone)} aria-hidden="true" title={`Health ${score}`} />;
}
