/**
 * React Query hooks for dataset exports (CSV / JSON / NDJSON downloads of a crawl run's data).
 *
 * Backed by the Express exports module (Supabase public.exports + the private "exports" Storage
 * bucket, per-user). Mirrors the sources hooks: mutations go through apiSend / apiGet (which attach
 * the Supabase Bearer token) and invalidate ["exports"] so lists re-fetch.
 *
 *   POST /api/crawls/:runId/exports  { dataset, format }  -> { id, status, url }
 *   GET  /api/exports?crawlId=                            -> ExportMeta[]
 *   GET  /api/exports/:id                                 -> ExportMeta & { url }
 *   GET  /api/exports/:id/download                        -> 302 to a fresh signed url (attachment)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export type ExportDataset = "pages" | "issues" | "links" | "media" | "failures" | "sitemap" | "fix-plan";
export type ExportFormat = "csv" | "json" | "ndjson";

export interface ExportMeta {
  id: string;
  crawlId: string;
  dataset: ExportDataset;
  format: ExportFormat;
  status: string;
  rows: number | null;
  bytes: number | null;
  createdAt: string;
  /** Present on GET /:id (fresh signed url) — omitted from the list rows. */
  url?: string | null;
}

export interface CreateExportRequest {
  runId: string;
  dataset: ExportDataset;
  format: ExportFormat;
}

export interface CreateExportResult {
  id: string;
  status: string;
  url: string | null;
}

const EXPORTS_KEY = ["exports"] as const;

/** List this user's exports (optionally scoped to one crawl). */
export function useExports(crawlId?: string) {
  return useQuery({
    queryKey: crawlId ? [...EXPORTS_KEY, crawlId] : EXPORTS_KEY,
    queryFn: () => apiGet<ExportMeta[]>(`/api/exports${crawlId ? `?crawlId=${encodeURIComponent(crawlId)}` : ""}`),
  });
}

/** One export's metadata + a fresh signed download url when completed. */
export function useExport(id: string | undefined) {
  return useQuery({
    queryKey: [...EXPORTS_KEY, "one", id],
    queryFn: () => apiGet<ExportMeta>(`/api/exports/${id}`),
    enabled: !!id,
  });
}

/** Generate an export (build + serialize + upload), then refresh the list. Returns the new id +
 *  a fresh signed url the caller can immediately open to download. */
export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, dataset, format }: CreateExportRequest) =>
      apiSend<CreateExportResult>("POST", `/api/crawls/${runId}/exports`, { dataset, format }),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXPORTS_KEY }),
  });
}

/**
 * Trigger a browser download of an export. The download route 302-redirects to a short-lived signed
 * Supabase Storage url (forced attachment). Because that route is auth-gated, we fetch it with the
 * Bearer token, follow the redirect, and save the resulting blob — rather than navigating the tab
 * (which would drop the Authorization header).
 */
export async function downloadExport(id: string, fileName?: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const base = (import.meta.env.VITE_API_BASE as string) ?? "";
  const res = await fetch(`${base}/api/exports/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName ?? `export-${id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
