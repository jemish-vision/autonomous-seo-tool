/**
 * React Query hook for the crawl queue / recent jobs (Queue page).
 *   GET /api/queue   ->  { jobs: QueueJob[], ...depth metadata }
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { QueueJob } from "@/lib/data-queue";

interface QueueResponse {
  jobs: QueueJob[];
  queuedCount: number;
  runningCount: number;
  runningRunId: string | null;
  workerCount: number;
}

export function useQueue() {
  return useQuery({
    queryKey: ["queue"],
    queryFn: () => apiGet<QueueResponse>("/api/queue").then((r) => r.jobs ?? []),
  });
}
