/**
 * Client type shim for the old server-only `lib/data-queue.ts` (node:fs status-file reads).
 * The job list is served by the API. Keeps ONLY the shared TYPES the /queue UI imports.
 *
 * TODO(api): use @/api/queue (GET /api/queue) for the QueueJob[] payload.
 */
export type JobState = "running" | "done" | "failed" | "cancelled";

export interface QueueJob {
  runId: string;
  state: JobState;
  startUrl: string;
  maxPages: number;
  maxDepth: number | null;
  startedAt: string;
  endedAt: string | null;
  label: string | null;
  note?: string;
}
