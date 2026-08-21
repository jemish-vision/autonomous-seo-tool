/**
 * React Query hooks for crawled pages (Pages explorer + page detail).
 *   GET /api/crawls/:runId/pages
 *   GET /api/crawls/:runId/pages/:pageId
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { CrawledPageWithId } from "@/lib/data";

export function usePages(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["pages", runId],
    queryFn: () => apiGet<{ pages: CrawledPageWithId[] }>(`/api/crawls/${runId}/pages`).then((r) => r.pages),
    enabled: Boolean(runId),
  });
}

export function usePage(runId: string | null | undefined, pageId: string | null | undefined) {
  return useQuery({
    queryKey: ["page", runId, pageId],
    queryFn: () => apiGet<{ page: CrawledPageWithId }>(`/api/crawls/${runId}/pages/${pageId}`).then((r) => r.page),
    enabled: Boolean(runId && pageId),
  });
}
