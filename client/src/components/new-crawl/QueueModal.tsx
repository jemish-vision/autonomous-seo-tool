import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListTodo, ExternalLink, Loader2, PlayCircle, Clock, CheckCircle2, XCircle, ArrowUpRight } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { StatValue } from "@/components/ui/stat-value";
import { Card } from "@/components/ui/card";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StopCrawlControl } from "@/components/crawl-control/StopCrawlControl";
import { hostnameFor, formatRunTimestamp } from "@/components/shell/run-label";
import type { CancelledCrawlStatus } from "@/lib/crawl-control-client";
import type { QueueJob } from "@/lib/data-queue";

interface QueueMeta {
  queuedCount: number;
  oldestQueuedAgeMs: number | null;
  runningCount: number;
  runningRunId: string | null;
  workerCount: number;
  note: string;
  jobs?: QueueJob[];
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

interface Props {
  open: boolean;
  onClose: () => void;
  onCancelled?: (crawl: CancelledCrawlStatus) => void;
}

export function QueueModal({ open, onClose, onCancelled }: Props) {
  const [meta, setMeta] = useState<QueueMeta | null>(null);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [progressUnavailable, setProgressUnavailable] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/queue", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data: QueueMeta = await res.json();
          setMeta(data);
          if (data.jobs) {
            setJobs(data.jobs);
          }
        }
      } catch {
        // best-effort
      }
    }

    void tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open]);

  const runningRunId = meta?.runningRunId ?? null;
  useEffect(() => {
    if (!open || !runningRunId) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    let stopped = false;
    let id: ReturnType<typeof setInterval> | undefined;
    async function fetchProgress() {
      if (stopped) return;
      try {
        const res = await fetch(`/api/crawls/${encodeURIComponent(runningRunId!)}/progress`, { cache: "no-store" });
        if (cancelled || stopped) return;
        // Live progress is streamed by the crawler worker (not in this deployment). A 501 (honest
        // stub) or 404 (route absent) means data will never arrive — stop polling this dead endpoint
        // every 1.5s and flag the tiles as unavailable rather than showing perpetual zeros.
        if (res.status === 501 || res.status === 404) {
          stopped = true;
          if (id) clearInterval(id);
          setProgressUnavailable(true);
          return;
        }
        if (res.ok) {
          setProgress((await res.json()) as Progress);
        }
      } catch {
        // best-effort
      }
    }
    void fetchProgress();
    id = setInterval(fetchProgress, 1500);
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [open, runningRunId]);

  const runningJob = jobs.find((j) => j.state === "running") ?? null;

  function handleCancelClick(runId: string, crawl: CancelledCrawlStatus) {
    setJobs((prev) =>
      prev.map((j) =>
        j.runId === runId
          ? { ...j, state: "cancelled" as const, endedAt: crawl.endedAt ?? new Date().toISOString(), note: crawl.note }
          : j,
      ),
    );
    if (onCancelled) onCancelled(crawl);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      className="max-h-[92vh]"
      title={
        <div className="flex items-center gap-2">
          <ListTodo size={18} className="text-primary" />
          <span>Crawl Queue & Workers</span>
        </div>
      }
      badge={
        meta?.runningCount ? (
          <Badge tone="warn" className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse" />
            1 Crawl Active
          </Badge>
        ) : (
          <Badge tone="neutral">Idle</Badge>
        )
      }
      headerRight={
        <Link
          to="/queue"
          target="_blank"
          className="flex items-center gap-1.5 rounded-control border border-border bg-subtle px-3 py-1 text-xs font-medium text-secondary hover:text-foreground hover:border-border-strong transition-colors"
        >
          <span>Open full screen</span>
          <ExternalLink size={12} strokeWidth={1.75} />
        </Link>
      }
      bodyClassName="p-3 sm:p-5 flex flex-col gap-3 sm:gap-4 overflow-y-auto"
    >
      {/* 4 Metrics Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 shrink-0">
        <Card className="p-3.5 rounded-xl">
          <StatValue value={meta ? meta.runningCount : "—"} caption="Running Crawls" />
        </Card>
        <Card className="p-3.5 rounded-xl">
          <StatValue value={meta ? meta.queuedCount : "—"} caption="Queued Jobs" />
        </Card>
        <Card className="p-3.5 rounded-xl">
          <StatValue
            value={
              meta?.oldestQueuedAgeMs !== null && meta?.oldestQueuedAgeMs !== undefined
                ? `${Math.round(meta.oldestQueuedAgeMs / 1000)}s`
                : "—"
            }
            caption="Oldest Queued Age"
          />
        </Card>
        <Card className="p-3.5 rounded-xl">
          <StatValue value={meta ? meta.workerCount : "—"} caption="Active Workers" />
        </Card>
      </div>

      {/* Currently Running Job Banner */}
      {runningJob && (
        <Card className="space-y-3.5 border-warn/50 bg-warn/5 p-4 rounded-xl shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Loader2 size={16} strokeWidth={2} className="animate-spin text-warn" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground">In-Progress Crawl</p>
              <Badge tone="warn">running</Badge>
              <span className="font-mono text-xs text-secondary">{runningJob.runId}</span>
            </div>
            <StopCrawlControl
              runId={runningJob.runId}
              size="sm"
              label="Cancel crawl"
              onCancelled={(crawl) => handleCancelClick(runningJob.runId, crawl)}
            />
          </div>

          <p className="truncate text-xs font-medium text-foreground">{runningJob.startUrl}</p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 pt-1">
            <StatValue value={elapsed(runningJob.startedAt, null)} caption="Elapsed Time" />
            <StatValue value={progress?.crawled ?? "—"} caption="Pages Crawled" />
            <StatValue value={progress?.discovered ?? "—"} caption="Discovered" />
            <StatValue value={progress?.failed ?? "—"} caption="Failed" />
            <StatValue value={progress?.blocked ?? "—"} caption="Robots Blocked" />
          </div>

          {progressUnavailable && (
            <p className="text-[11px] text-faint">Live progress unavailable — requires the crawler worker, which isn’t part of this build.</p>
          )}
        </Card>
      )}

      {/* Jobs History Table Section (Expanded Height) */}
      <div className="flex-1 flex flex-col min-h-0 space-y-2.5">
        <div className="flex items-center justify-between shrink-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">Crawl Queue & Job History</h3>
          <span className="text-xs text-faint">{jobs.length} jobs recorded</span>
        </div>

        {jobs.length === 0 ? (
          <EmptyState icon={ListTodo} title="No crawl jobs yet" description="Jobs started from New Crawl will appear here." />
        ) : (
          <div className="flex-1 max-h-[460px] overflow-y-auto rounded-xl border border-border bg-card">
            <TableContainer className="border-0 rounded-none shadow-none">
              <TableHead>
                <Th>Target Site / Run</Th>
                <Th>Status</Th>
                <Th>Max Pages</Th>
                <Th>Elapsed Time</Th>
                <Th>Started At</Th>
                <Th className="text-right">Actions</Th>
              </TableHead>
              <tbody>
                {jobs.map((job) => (
                  <Tr key={job.runId}>
                    <Td className="font-mono text-xs font-medium text-foreground">
                      <div className="flex flex-col">
                        <Link
                          to={`/pages?run=${encodeURIComponent(job.runId)}`}
                          className="font-sans font-semibold text-primary hover:underline truncate max-w-[240px]"
                          title={job.startUrl}
                        >
                          {hostnameFor(job.startUrl)}
                        </Link>
                        <span className="text-[11px] text-faint truncate font-mono mt-0.5">{job.runId}</span>
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={STATE_TONE[job.state]}>{job.state}</Badge>
                    </Td>
                    <Td className="text-xs">{job.maxPages === 0 ? "Unlimited" : `${job.maxPages} max`}</Td>
                    <Td className="text-xs tabular-nums text-secondary">{elapsed(job.startedAt, job.endedAt)}</Td>
                    <Td className="text-xs text-faint tabular-nums">{formatRunTimestamp(job.startedAt)}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          to={`/pages?run=${encodeURIComponent(job.runId)}`}
                          className="inline-flex items-center gap-1 rounded-control border border-border bg-subtle px-2.5 py-1 text-xs font-medium text-secondary hover:text-foreground hover:border-border-strong transition-colors"
                        >
                          <span>Pages</span>
                          <ArrowUpRight size={12} strokeWidth={1.75} />
                        </Link>
                        <Link
                          to={`/?run=${encodeURIComponent(job.runId)}`}
                          className="inline-flex items-center gap-1 rounded-control border border-border bg-subtle px-2.5 py-1 text-xs font-medium text-secondary hover:text-foreground hover:border-border-strong transition-colors"
                        >
                          <span>Overview</span>
                        </Link>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          </div>
        )}
      </div>
    </Modal>
  );
}
