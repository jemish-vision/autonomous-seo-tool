/**
 * React Query hook for the AI-crawler access verdict table shown on the Sitemap page.
 *   GET /api/crawls/:runId/site-files/ai-access   (server runs buildAiAccessTable)
 *
 * Robots/sitemap evidence, blocked, failures and skipped all come from the existing useRun hook
 * (RunDetail already carries them); this only supplies the 13-agent AI-access table.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { AiAccessRow } from "@/lib/data-sitefiles";

export interface AiAccessTable {
  rows: AiAccessRow[];
  parseStatus: string;
}

export function useAiAccess(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["ai-access", runId],
    queryFn: () => apiGet<AiAccessTable | null>(`/api/crawls/${runId}/site-files/ai-access`),
    enabled: Boolean(runId),
  });
}
