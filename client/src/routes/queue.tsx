import { useQueue } from "@/api/queue";
import { QueueClient } from "@/components/queue/queue-client";

/** Crawl queue / recent jobs. Old: app/queue/page.tsx (listJobs -> QueueClient). */
export function QueueRoute() {
  const { data, isLoading } = useQueue();
  if (isLoading) return <p className="text-sm text-secondary">Loading…</p>;
  return <QueueClient initialJobs={data ?? []} />;
}
