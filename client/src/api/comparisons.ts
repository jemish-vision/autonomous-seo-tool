/**
 * React Query hooks for SAVED comparisons (persisted crawl-over-crawl diffs / competitor
 * aggregates). Backed by the Express /api/comparisons module (Supabase public.comparisons,
 * per-user). Mirrors the api/sources.ts pattern: query keys + apiGet/apiSend, mutations invalidate
 * ["comparisons"] so the saved list re-fetches.
 *
 * This is the PERSISTED entity — distinct from api/compare.ts, which is the on-the-fly live diff.
 *
 *   POST /api/comparisons            -> ComparisonResult
 *   GET  /api/comparisons?siteId=    -> ComparisonSummary[]
 *   GET  /api/comparisons/:id?section=summary|pages|issues|measurements
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import type { CrawlDiff } from "@/lib/data-compare";

export type ComparisonMode = "run-over-run" | "competitor";

export interface ComparisonSummary {
  id: string;
  siteId: string | null;
  baseCrawlId: string;
  againstCrawlId: string;
  mode: ComparisonMode;
  createdAt: string;
  status: "completed";
}

export interface CompetitorAggregate {
  base: { runId: string; healthScore: number | null; pagesAnalyzed: number | null; coveragePercent: number };
  against: { runId: string; healthScore: number | null; pagesAnalyzed: number | null; coveragePercent: number };
}

export interface ComparisonResult extends ComparisonSummary {
  runOverRun: CrawlDiff | null;
  competitor: CompetitorAggregate | null;
}

export interface CreateComparisonRequest {
  baseCrawlId: string;
  againstCrawlId: string;
  mode: ComparisonMode;
  siteId?: string;
}

const COMPARISONS_KEY = ["comparisons"] as const;

/** This user's saved comparisons (summaries), newest first. */
export function useComparisons(siteId?: string | null) {
  return useQuery({
    queryKey: [...COMPARISONS_KEY, siteId ?? null],
    queryFn: () =>
      apiGet<ComparisonSummary[]>(`/api/comparisons${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ""}`),
  });
}

/** Compute + persist a comparison, then refresh the saved list. */
export function useCreateComparison() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateComparisonRequest) => apiSend<ComparisonResult>("POST", "/api/comparisons", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMPARISONS_KEY }),
  });
}

/** One saved comparison, sliced by section (defaults to the full stored result via no section). */
export function useComparison<T = ComparisonResult>(
  id: string | null | undefined,
  section?: "summary" | "pages" | "issues" | "measurements",
) {
  return useQuery({
    queryKey: [...COMPARISONS_KEY, "detail", id, section ?? null],
    queryFn: () =>
      apiGet<T>(`/api/comparisons/${id}${section ? `?section=${section}` : ""}`),
    enabled: Boolean(id),
  });
}
