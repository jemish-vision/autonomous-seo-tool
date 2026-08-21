import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Loader2, ListTodo } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import { Badge } from "@/components/ui/badge";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StopCrawlControl } from "@/components/crawl-control/StopCrawlControl";
import type { CancelledCrawlStatus } from "@/lib/crawl-control-client";
import { cn } from "@/lib/cn";
import type { QueueJob } from "@/lib/data-queue";

interface QueueMeta {
  queuedCount: number;
  oldestQueuedAgeMs: number | null;
  runningCount: number;
  runningRunId: string | null;
  workerCount: number;
  note: string;
}

interface Progress {
  state: string;
  crawled: number;
  discovered: number | null;
  failed: number | null;
  blocked: number | null;
  rendered: number | null;
}

const STATE_TONE: Record<QueueJob["state"], "ok" | "warn" | "danger" | "neutral"> = {
  running: "warn",
  done: "ok",
  failed: "danger",
  cancelled: "neutral",
};

function elapsed(startedAt: string, endedAt: string | null): string {
  const ms = (endedAt ? new Date(endedAt).getTime() : Date.now()) - new Date(startedAt).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export function QueueClient({ initialJobs }: { initialJobs: QueueJob[] }) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState(initialJobs);
  const [meta, setMeta] = useState<QueueMeta | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [progressUnavailable, setProgressUnavailable] = useState(false);
  const [concurrency, setConcurrency] = useState(4);

  const runningJob = jobs.find((j) => j.state === "running") ?? null;

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/queue", { cache: "no-store" });
        if (res.ok && !cancelled) setMeta((await res.json()) as QueueMeta);
      } catch {
        // best-effort polling — a transient network hiccup shouldn't crash the queue screen
      }
    }
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const runningRunId = meta?.runningRunId ?? null;
  useEffect(() => {
    if (!runningRunId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale progress when the run that owned it stops is the sync, not a render loop
      setProgress(null);
      return;
    }
    let cancelled = false;
    let stopped = false;
    let id: ReturnType<typeof setInterval> | undefined;
    async function tick() {
      if (stopped) return;
      try {
        const res = await fetch(`/api/crawls/${encodeURIComponent(runningRunId!)}/progress`, { cache: "no-store" });
        if (cancelled || stopped) return;
        // Live progress is streamed by the crawler worker (not in this deployment). A 501 (honest
        // stub) or 404 (route absent) means this endpoint will never return data — stop polling it
        // every 1.5s and flag the tiles as unavailable instead of hammering a dead endpoint.
        if (res.status === 501 || res.status === 404) {
          stopped = true;
          if (id) clearInterval(id);
          setProgressUnavailable(true);
          return;
        }
        if (res.ok) setProgress((await res.json()) as Progress);
      } catch {
        // best-effort
      }
    }
    void tick();
    id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [runningRunId]);

  async function refreshJobs() {
    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      if (res.ok) setMeta((await res.json()) as QueueMeta);
    } catch {
      // best-effort
    }
  }

  // Only fires once the backend response confirms the process was actually killed — never
  // optimistically on click (see StopCrawlControl's onCancelled contract).
  function handleCancelled(runId: string, crawl: CancelledCrawlStatus) {
    setJobs((prev) =>
      prev.map((j) =>
        j.runId === runId
          ? { ...j, state: "cancelled" as const, endedAt: crawl.endedAt ?? new Date().toISOString(), note: crawl.note }
          : j,
      ),
    );
    void refreshJobs();
    // Sidebar "Runs" count comes from the shared layout, read once per render — refresh it too so
    // it doesn't lag behind the run this screen just showed as cancelled.
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <StatValue value={meta ? meta.runningCount : "—"} caption="Running" />
        </Card>
        <Card>
          <StatValue value={meta ? meta.queuedCount : "—"} caption="Queued" />
        </Card>
        <Card>
          <StatValue value={meta?.oldestQueuedAgeMs !== null && meta?.oldestQueuedAgeMs !== undefined ? `${Math.round(meta.oldestQueuedAgeMs / 1000)}s` : "—"} caption="Oldest queued age" />
        </Card>
        <Card>
          <StatValue value={meta ? meta.workerCount : "—"} caption="Workers" />
        </Card>
      </div>

      {meta?.note && <p className="text-xs text-faint">{meta.note}</p>}

      {runningJob && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Loader2 size={16} strokeWidth={2} className="animate-spin text-warn" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">Currently running</p>
            <Badge tone="warn">running</Badge>
            <span className="font-mono text-xs text-faint">{runningJob.runId}</span>
            <StopCrawlControl
              runId={runningJob.runId}
              size="sm"
              label="Stop crawl"
              className="ml-auto"
              onCancelled={(crawl) => handleCancelled(runningJob.runId, crawl)}
            />
          </div>
          <p className="truncate text-xs text-secondary">{runningJob.startUrl}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 sm:gap-3">
            <StatValue value={elapsed(runningJob.startedAt, null)} caption="Elapsed" />
            <StatValue value={progress?.crawled ?? "—"} caption="Crawled" />
            <StatValue value={progress?.discovered ?? "—"} caption="Discovered" />
            <StatValue value={progress?.failed ?? "—"} caption="Failed" />
            <StatValue value={progress?.blocked ?? "—"} caption="Blocked" />
          </div>

          {progressUnavailable && (
            <p className="text-[11px] text-faint">Live progress unavailable — requires the crawler worker, which isn’t part of this build.</p>
          )}

          <div className="border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-medium text-foreground">Parallel requests (1–8)</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {CONCURRENCY_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled
                  onClick={() => setConcurrency(n)}
                  aria-pressed={concurrency === n}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-control border text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60",
                    concurrency === n ? "border-primary bg-primary text-primary-contrast" : "border-border bg-subtle text-secondary",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-faint">
              Not wired to a live endpoint yet — this build has no API for changing concurrency on an in-flight crawl. Set it at crawl
              start from <Link to="/new-crawl" className="text-primary underline underline-offset-2">New crawl</Link>.
            </p>
          </div>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Job history</h2>
        {jobs.length === 0 ? (
          <EmptyState icon={ListTodo} title="No crawl jobs yet" description="Jobs started from New Crawl will appear here." />
        ) : (
          <TableContainer>
            <TableHead>
              <Th>Run</Th>
              <Th>State</Th>
              <Th>Position</Th>
              <Th>Priority</Th>
              <Th>Start URL</Th>
              <Th>Max pages</Th>
              <Th>Elapsed</Th>
              <Th>&nbsp;</Th>
            </TableHead>
            <tbody>
              {jobs.map((job) => (
                <Tr key={job.runId}>
                  <Td className="normal-case">
                    <Link to={`/?run=${encodeURIComponent(job.runId)}`} className="font-mono text-xs text-primary underline underline-offset-2">
                      {job.label ?? job.runId}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={STATE_TONE[job.state]}>{job.state}</Badge>
                  </Td>
                  <Td className="text-faint">{job.state === "running" ? "1" : "—"}</Td>
                  <Td className="text-faint">—</Td>
                  <Td className="max-w-xs truncate normal-case text-secondary">{job.startUrl}</Td>
                  <Td>{job.maxPages === 0 ? "unlimited" : job.maxPages}</Td>
                  <Td>{elapsed(job.startedAt, job.endedAt)}</Td>
                  <Td>
                    {job.state === "running" ? (
                      <StopCrawlControl runId={job.runId} size="sm" label="Cancel" onCancelled={(crawl) => handleCancelled(job.runId, crawl)} />
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}
        <p className="text-[11px] text-faint">
          Position and priority are always “—” for non-running jobs — this POC runs one crawl at a time with no queue ordering behind it
          (see app/api/queue/route.ts). A queued second crawl is rejected with 409, not silently ordered.
        </p>
      </section>
    </div>
  );
}
