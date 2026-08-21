import { useEffect, useRef, useState } from "react";
import { Radar, ListTodo, FileText, LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnalyzeNowButton } from "@/components/analyze-now-button";
import { ActivityStreamClient } from "@/components/activity/activity-stream-client";
import { StatusChip } from "./StatusChip";
import { StopCrawlControl } from "@/components/crawl-control/StopCrawlControl";
import type { CancelledCrawlStatus } from "@/lib/crawl-control-client";
import type { CrawlStatusResponse, PanelState } from "./types";

interface Props {
  panelState: PanelState;
  url: string;
  runId: string | null;
  status: CrawlStatusResponse | null;
  onViewRun: () => void;
  onViewDashboard?: () => void;
  /** Called after an in-app "Analyze & view issues" finishes (post-analyze router.refresh already
   *  happened inside the button) — the parent navigates to /issues?run= here. */
  onViewIssues?: () => void;
  // onOpenActivity — the Activity Log moved out of the modal into the inline panel below (the
  // full activity stream replaces the raw Log tail; no modal entry points remain).
  onOpenQueue?: () => void;
  onRetry: () => void;
  onCancelled: (crawl: CancelledCrawlStatus) => void;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Owns the elapsed-time tick in isolation, remounted via `key={runId}` from the parent so a new
 * crawl starts its clock at 0 for free (React's documented reset-via-key pattern) instead of a
 * setState call inside an effect body reacting to a prop change (react-hooks/set-state-in-effect)
 * or a ref mutated during render (react-hooks/refs) — both rejected by this project's lint config.
 */
function ElapsedClock({ active }: { active: boolean }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (startRef.current === null) startRef.current = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - (startRef.current ?? Date.now())), 1000);
    return () => clearInterval(id);
  }, [active]);

  return <span className="text-xs tabular-nums text-faint">{formatElapsed(elapsedMs)}</span>;
}

export function ProgressPanel({
  panelState,
  url,
  runId,
  status,
  onViewRun,
  onViewDashboard,
  onViewIssues,
  onOpenQueue,
  onRetry,
  onCancelled,
}: Props) {

  if (panelState === "form") {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={Radar}
          title="No crawl running"
          description="Fill out the form and submit to start a new crawl."
        />
      </div>
    );
  }

  if (panelState === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
        <StatusChip state="starting" />
        <p className="text-sm text-secondary">Spawning crawler…</p>
        <div className="flex items-center gap-2 pt-4">
          {/* Live Activity button removed with the modal — see the empty-state note above. */}
          {/* {onOpenActivity && (
            <Button type="button" variant="outline" size="sm" onClick={onOpenActivity}>
              <RadioTower size={13} strokeWidth={1.75} />
              <span>Live Activity</span>
            </Button>
          )} */}
          {onOpenQueue && (
            <Button type="button" variant="outline" size="sm" onClick={onOpenQueue}>
              <ListTodo size={13} strokeWidth={1.75} />
              <span>Queue Status</span>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <StatusChip state={panelState} />
        <ElapsedClock key={runId ?? "unknown"} active={panelState === "running"} />
      </div>

      <p className="truncate text-sm font-medium text-foreground">
        {panelState === "running" && `Crawling ${url}`}
        {panelState === "done" && "Crawl complete"}
        {panelState === "failed" && "Crawl failed"}
        {panelState === "cancelled" && "Crawl cancelled"}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {runId && <p className="text-xs text-faint">run: {runId}</p>}
          {panelState === "done" && status && (
            <Badge tone={status.reportReady ? "ok" : "neutral"}>
              {status.reportReady ? "Report ready" : "Report pending"}
            </Badge>
          )}
        </div>

        {/* Quick Modal Triggers — both the Activity and Queue ghost triggers are commented out
            per owner request 2026-08-14: the activity log is inline below (full event stream,
            no filters) and the Queue button was removed from this row. */}
        <div className="flex items-center gap-1.5">
          {/* {onOpenActivity && (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenActivity} title="Open Activity Stream">
              <RadioTower size={13} strokeWidth={1.75} className={panelState === "running" ? "text-ok animate-pulse" : "text-secondary"} />
              <span className="text-xs">Activity</span>
            </Button>
          )} */}
          {/* {onOpenQueue && (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenQueue} title="Open Crawl Queue">
              <ListTodo size={13} strokeWidth={1.75} className="text-secondary" />
              <span className="text-xs">Queue</span>
            </Button>
          )} */}
        </div>
      </div>

      {panelState === "failed" && status && <p className="text-xs text-danger">exit code {status.exitCode ?? "unknown"}</p>}
      {panelState === "cancelled" && status?.note && <p className="text-xs text-secondary">{status.note}</p>}

      {panelState === "running" && runId && <StopCrawlControl runId={runId} onCancelled={onCancelled} className="self-start" />}

      {/* Raw Log tail (crawl.log text) — commented out per owner request 2026-08-14: the full
          activity stream below takes its place (every crawl event + progress row, same as the
          Activity Log page). Re-enable to restore the raw log tail. */}
      {/* <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">Log tail</p>
        <pre
          ref={logRef}
          className="max-h-80 overflow-y-auto rounded-control border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed text-secondary whitespace-pre-wrap break-all"
        >
          {status?.log && status.log.length > 0 ? status.log.join("\n") : "waiting for output…"}
        </pre>
      </div> */}

      {runId && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">Activity log</p>
          {/* Owner request 2026-08-14: every crawl event stays visible here, but the search/
              status/kind filter bar is hidden — the Activity Log page keeps its filters. */}
          <ActivityStreamClient
            key={runId}
            runId={runId}
            initialEvents={[]}
            initialSource="durable"
            urlToPageId={[]}
            hideFilters
          />
        </div>
      )}

      {panelState === "done" && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="primary" onClick={onViewRun} className="flex items-center justify-center gap-2">
              <FileText size={15} strokeWidth={1.75} />
              <span>Explore Pages</span>
            </Button>
            {onViewDashboard && (
              <Button variant="outline" onClick={onViewDashboard} className="flex items-center justify-center gap-2">
                <LayoutDashboard size={15} strokeWidth={1.75} />
                <span>Dashboard Overview</span>
              </Button>
            )}
          </div>
          {runId && onViewIssues && (
            <AnalyzeNowButton
              runId={runId}
              label="Analyze & view issues"
              variant="outline"
              size="md"
              fullWidth
              onComplete={onViewIssues}
            />
          )}
        </div>
      )}
      {panelState === "failed" && (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
      {panelState === "cancelled" && (
        <Button variant="outline" onClick={onRetry}>
          Start another crawl
        </Button>
      )}
    </div>
  );
}
