import { useEffect, useRef, useState } from "react";
import { RadioTower, RefreshCw, ChevronDown, Check, Globe } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivityStreamClient } from "@/components/activity/activity-stream-client";
import { hostnameFor, formatRunTimestamp } from "@/components/shell/run-label";
import { cn } from "@/lib/cn";

interface RunItem {
  runId: string;
  startUrl: string;
  startedAt: string;
  status: "running" | "completed";
  successful?: number;
  coveragePercent?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentRunId: string | null;
  isCrawling?: boolean;
}

export function ActivityModal({ open, onClose, currentRunId, isCrawling }: Props) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(currentRunId);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Follow the parent's current run (a fresh crawl's id) without an effect — same render-time
  // sync pattern the explorer clients use (adjusting state from a prop transition, not an
  // effect body, per react-hooks/set-state-in-effect). On mount the initial value already equals
  // currentRunId, so this only fires when the parent's run actually changes.
  const [syncedRunId, setSyncedRunId] = useState<string | null>(currentRunId);
  if (currentRunId && currentRunId !== syncedRunId) {
    setSyncedRunId(currentRunId);
    setSelectedRunId(currentRunId);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadRuns() {
      setLoadingRuns(true);
      try {
        const res = await fetch("/api/crawls?pageSize=30", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const list: RunItem[] = (data.data || []).map(
            (r: { runId: string; startUrl: string; startedAt: string; status: "running" | "completed"; successful?: number; coveragePercent?: number }) => ({
              runId: r.runId,
              startUrl: r.startUrl,
              startedAt: r.startedAt,
              status: r.status,
              successful: r.successful,
              coveragePercent: r.coveragePercent,
            }),
          );
          setRuns(list);
          if (!selectedRunId && list.length > 0) {
            setSelectedRunId(currentRunId || list[0].runId);
          }
        }
      } catch {
        // best effort
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    }

    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, [open, currentRunId, selectedRunId]);

  // Outside click & escape listener for custom dropdown
  useEffect(() => {
    if (!dropdownOpen) return;
    function onDocClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [dropdownOpen]);

  const activeRun = runs.find((r) => r.runId === selectedRunId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      className="max-h-[88vh] h-[88vh]"
      title={
        <div className="flex items-center gap-2">
          <RadioTower size={18} className={isCrawling ? "text-ok animate-pulse" : "text-primary"} />
          <span>Activity Stream</span>
        </div>
      }
      badge={
        selectedRunId ? (
          <Badge tone={isCrawling && selectedRunId === currentRunId ? "ok" : "neutral"}>
            {isCrawling && selectedRunId === currentRunId ? "Live Crawl" : "Historical Run"}
          </Badge>
        ) : null
      }
      // "Open full screen" link to /activity removed with the Activity Log sidebar move — the
      // Activity Log now lives here (New Crawl) showing the full event stream, and the old
      // full-page stream is no longer linked from anywhere. Re-enable by uncommenting.
      // headerRight={
      //   selectedRunId ? (
      //     <Link
      //       to={`/activity?run=${encodeURIComponent(selectedRunId)}`}
      //       target="_blank"
      //       className="flex items-center gap-1.5 rounded-control border border-border bg-subtle px-3 py-1 text-xs font-medium text-secondary hover:text-foreground hover:border-border-strong transition-colors"
      //     >
      //       <span>Open full screen</span>
      //       <ExternalLink size={12} strokeWidth={1.75} />
      //     </Link>
      //   ) : null
      // }
      bodyClassName="p-3 sm:p-5 flex flex-col gap-3 sm:gap-4 overflow-hidden"
    >
      {/* Run Selector Custom Dropdown Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-secondary">Target Run:</span>

          {runs.length > 0 ? (
            <div ref={dropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                className="inline-flex items-center gap-2 rounded-pill border border-border-strong bg-elevated px-3 py-1.5 text-xs font-medium text-foreground shadow-card transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Globe size={13} strokeWidth={1.75} className="text-primary" />
                <span className="max-w-[200px] truncate font-medium">
                  {activeRun ? hostnameFor(activeRun.startUrl) : selectedRunId}
                </span>
                {activeRun?.startedAt && (
                  <span className="text-faint">· {formatRunTimestamp(activeRun.startedAt)}</span>
                )}
                {selectedRunId === currentRunId && isCrawling && (
                  <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" title="Active live crawl" />
                )}
                <ChevronDown
                  size={13}
                  strokeWidth={1.75}
                  className={cn("text-secondary transition-transform duration-150", dropdownOpen && "rotate-180")}
                />
              </button>

              {dropdownOpen && (
                <ul
                  role="listbox"
                  aria-label="Select crawl run"
                  className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-72 w-88 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-elevated py-1.5 shadow-popover divide-y divide-border/40"
                >
                  {runs.map((run) => {
                    const isSelected = run.runId === selectedRunId;
                    const isCurrent = run.runId === currentRunId;
                    return (
                      <li key={run.runId}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setSelectedRunId(run.runId);
                            setDropdownOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-start justify-between gap-2 px-3.5 py-2.5 text-left text-xs transition-colors duration-150 hover:bg-subtle",
                            isSelected && "bg-subtle",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-semibold text-foreground">
                                {hostnameFor(run.startUrl)}
                              </span>
                              {isCurrent && (
                                <Badge tone="ok" className="text-[10px] py-0 px-1.5">
                                  Current
                                </Badge>
                              )}
                              {run.status === "running" && !isCurrent && (
                                <Badge tone="warn" className="text-[10px] py-0 px-1.5">
                                  Running
                                </Badge>
                              )}
                            </div>
                            <p className="truncate font-mono text-[11px] text-faint mt-0.5">{run.runId}</p>
                            <p className="text-[11px] text-secondary mt-0.5">
                              {formatRunTimestamp(run.startedAt)}
                              {run.coveragePercent !== undefined && ` · ${run.coveragePercent}% coverage`}
                              {run.successful !== undefined && ` · ${run.successful} pages`}
                            </p>
                          </div>
                          {isSelected && <Check size={14} strokeWidth={2} className="text-primary shrink-0 mt-1" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : selectedRunId ? (
            <span className="font-mono text-xs font-semibold text-foreground px-2 py-1 rounded border border-border bg-subtle">
              {selectedRunId}
            </span>
          ) : (
            <span className="text-xs text-faint">No runs recorded</span>
          )}
        </div>

        {activeRun && (
          <div className="flex items-center gap-2 text-xs text-secondary">
            <span className="font-mono text-[11px] text-faint truncate max-w-xs">{activeRun.runId}</span>
          </div>
        )}
      </div>

      {/* Stream Container */}
      <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
        {selectedRunId ? (
          <ActivityStreamClient
            key={selectedRunId}
            runId={selectedRunId}
            initialEvents={[]}
            initialSource="durable"
            urlToPageId={[]}
            className="flex-1 h-full min-h-[440px] min-w-0"
          />
        ) : loadingRuns ? (
          <div className="flex h-72 items-center justify-center">
            <RefreshCw size={22} className="animate-spin text-primary" />
          </div>
        ) : (
          <div className="py-16">
            <EmptyState
              icon={RadioTower}
              title="No crawl run selected"
              description="Start a new crawl or select an existing run from the dropdown above to inspect real-time logs."
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
