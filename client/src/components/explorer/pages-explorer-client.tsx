import { useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Search, FileText, ChevronRight, X, Download } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { CopyButton } from "@/components/ui/copy-button";
import { exportToCsv } from "@/lib/export-csv";
import { useCreateExport, downloadExport } from "@/api/exports";
import { cn } from "@/lib/cn";
import {
  statusTone,
  STATUS_BUCKETS,
  filterAndSortRows,
  groupBySection,
  type ExplorerRow,
  type StatusBucket,
  type SortKey,
} from "@/lib/explorer-shared";

const PAGE_SIZE = 100;
const STATUS_VALUES: StatusBucket[] = ["2xx", "3xx", "4xx", "5xx", "failed", "blocked"];
const SORT_VALUES: SortKey[] = ["url", "status", "depth", "wordCount", "responseTime", "pagerank"];

function bucketBadgeTone(bucket: StatusBucket): "ok" | "warn" | "danger" | "neutral" {
  if (bucket === "2xx") return "ok";
  if (bucket === "3xx") return "warn";
  if (bucket === "4xx" || bucket === "5xx" || bucket === "failed") return "danger";
  return "warn";
}

export function PagesExplorerClient({ rows, runId }: { rows: ExplorerRow[]; runId: string }) {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const status = STATUS_VALUES.includes(searchParams.get("status") as StatusBucket) ? (searchParams.get("status") as StatusBucket) : null;
  const rendered =
    searchParams.get("rendered") === "http" || searchParams.get("rendered") === "playwright"
      ? (searchParams.get("rendered") as "http" | "playwright")
      : null;
  const depthParam = searchParams.get("depth");
  const depth = depthParam !== null && depthParam !== "" ? Number(depthParam) : null;
  const sortKey = SORT_VALUES.includes(searchParams.get("sort") as SortKey) ? (searchParams.get("sort") as SortKey) : null;
  const sortDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const grouped = searchParams.get("group") === "1";
  const sectionFilter = searchParams.get("section");

  // Local, immediately-responsive copy of q; URL is updated on a short debounce so refresh/share
  // stays correct without a router.replace on every keystroke. Synced from urlQ during render
  // (React's "adjusting state" pattern) rather than an effect, to avoid a cascading extra render.
  const [qInput, setQInput] = useState(urlQ);
  const [syncedUrlQ, setSyncedUrlQ] = useState(urlQ);
  if (urlQ !== syncedUrlQ) {
    setSyncedUrlQ(urlQ);
    setQInput(urlQ);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [visible, setVisible] = useState(PAGE_SIZE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Server-side export: builds the full pages dataset in Supabase (public.exports + Storage) and
  // downloads it. Distinct from the client-side "Export CSV" which only serializes the rows
  // currently in the browser; this exports the whole crawl's pages via the exports API.
  const createExport = useCreateExport();
  const [exporting, setExporting] = useState(false);
  async function handleServerExport() {
    setExporting(true);
    try {
      const result = await createExport.mutateAsync({ runId, dataset: "pages", format: "csv" });
      await downloadExport(result.id, `${runId}-pages.csv`);
    } finally {
      setExporting(false);
    }
  }

  // Reset pagination when the active filter set changes — same during-render pattern as above.
  const filterSignature = `${status}|${rendered}|${depth}|${sectionFilter}|${grouped}`;
  const [syncedFilterSignature, setSyncedFilterSignature] = useState(filterSignature);
  if (filterSignature !== syncedFilterSignature) {
    setSyncedFilterSignature(filterSignature);
    setVisible(PAGE_SIZE);
  }

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    navigate(`${pathname}?${next.toString()}`, { replace: true });
  }

  function handleQChange(value: string) {
    setQInput(value);
    setVisible(PAGE_SIZE);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: value || null }), 250);
  }

  const statusCounts = useMemo(() => {
    const counts: Record<StatusBucket, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, failed: 0, blocked: 0 };
    for (const r of rows) counts[r.bucket]++;
    return counts;
  }, [rows]);

  const depths = useMemo(() => [...new Set(rows.map((r) => r.depth).filter((d): d is number => d !== null))].sort((a, b) => a - b), [rows]);
  const renderModes = useMemo(
    () => [...new Set(rows.map((r) => r.renderedWith).filter((r): r is "http" | "playwright" => r !== null))],
    [rows],
  );

  const filtered = useMemo(
    () =>
      filterAndSortRows(rows, {
        q: qInput,
        status,
        rendered,
        depth,
        section: sectionFilter,
        sort: sortKey,
        dir: sortDir,
      }),
    [rows, qInput, status, rendered, depth, sectionFilter, sortKey, sortDir],
  );

  const groups = useMemo(() => (grouped ? groupBySection(filtered) : []), [grouped, filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) updateParams({ sort: key, dir: "asc" });
    else if (sortDir === "asc") updateParams({ sort: key, dir: "desc" });
    else updateParams({ sort: null, dir: null });
  }

  function toggleCollapsed(section: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  // Same filter context appended to every detail link, so Prev/Next on the detail page walks
  // exactly the set the user is looking at here (Law 1).
  const detailQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set("run", runId);
    if (qInput) p.set("q", qInput);
    if (status) p.set("status", status);
    if (rendered) p.set("rendered", rendered);
    if (depth !== null) p.set("depth", String(depth));
    if (sortKey) p.set("sort", sortKey);
    if (sortDir === "desc") p.set("dir", "desc");
    return p.toString();
  }, [runId, qInput, status, rendered, depth, sortKey, sortDir]);

  function renderRow(row: ExplorerRow) {
    return (
      <Tr key={row.key}>
        <Td className="max-w-md normal-case">
          <div className="flex items-center gap-1.5 min-w-0">
            {row.pageId ? (
              <Link to={`/pages/${row.pageId}?${detailQuery}`} className="truncate text-primary underline underline-offset-2" title={row.url}>
                {row.url}
              </Link>
            ) : (
              <span className="truncate text-foreground" title={row.url}>{row.url}</span>
            )}
            <CopyButton text={row.url} label="Copy page URL" />
          </div>
        </Td>
        <Td>
          {row.bucket === "failed" ? (
            <Badge tone="danger">{row.reason ?? "failed"}</Badge>
          ) : row.bucket === "blocked" ? (
            <Badge tone="warn">blocked</Badge>
          ) : (
            <Badge tone={statusTone(row.statusCode)}>{row.statusCode}</Badge>
          )}
        </Td>
        <Td className="font-medium">{row.depth ?? <span className="text-faint">—</span>}</Td>
        <Td className="text-secondary">{row.renderedWith ?? <span className="text-faint">—</span>}</Td>
        <Td>{row.wordCount ?? <span className="text-faint">—</span>}</Td>
        <Td>{row.responseTimeMs !== null ? `${row.responseTimeMs}ms` : <span className="text-faint">—</span>}</Td>
        <Td>{row.pagerank !== undefined && row.pagerank !== null ? row.pagerank.toFixed(4) : <span className="text-faint">—</span>}</Td>
      </Tr>
    );
  }

  const tableHead = (
    <TableHead>
      <Th sortDir={sortKey === "url" ? sortDir : null} onSort={() => toggleSort("url")}>
        URL
      </Th>
      <Th sortDir={sortKey === "status" ? sortDir : null} onSort={() => toggleSort("status")}>
        Status
      </Th>
      <Th sortDir={sortKey === "depth" ? sortDir : null} onSort={() => toggleSort("depth")}>
        Depth
      </Th>
      <Th>Rendered</Th>
      <Th sortDir={sortKey === "wordCount" ? sortDir : null} onSort={() => toggleSort("wordCount")}>
        Words
      </Th>
      <Th sortDir={sortKey === "responseTime" ? sortDir : null} onSort={() => toggleSort("responseTime")}>
        Response
      </Th>
      <Th sortDir={sortKey === "pagerank" ? sortDir : null} onSort={() => toggleSort("pagerank")}>
        PageRank
      </Th>
    </TableHead>
  );

  function handleExportCsv() {
    exportToCsv(
      `pages-${runId}`,
      filtered as unknown as Record<string, unknown>[],
      [
        { key: "url", label: "URL" },
        { key: "statusCode", label: "Status Code" },
        { key: "bucket", label: "Status Bucket" },
        { key: "depth", label: "Crawl Depth" },
        { key: "wordCount", label: "Word Count" },
        { key: "responseTimeMs", label: "Response Time (ms)" },
        { key: "renderedWith", label: "Rendered With" },
        { key: "pagerank", label: "PageRank" },
      ]
    );
  }

  const visibleRows = filtered.slice(0, visible);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-9 w-full max-w-md items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
          <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => handleQChange(e.target.value)}
            placeholder="Filter by URL..."
            aria-label="Filter pages by URL"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="gap-1.5 h-9"
            title="Export current filtered pages to CSV"
          >
            <Download size={14} /> Export CSV ({filtered.length})
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleServerExport}
            disabled={exporting || createExport.isPending}
            className="gap-1.5 h-9"
            title="Export the full pages dataset via the server (CSV)"
          >
            <Download size={14} /> {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Status</span>
        <Chip active={status === null} onClick={() => updateParams({ status: null })}>
          All ({rows.length})
        </Chip>
        {STATUS_BUCKETS.map((b) => (
          <Chip key={b.key} active={status === b.key} onClick={() => updateParams({ status: status === b.key ? null : b.key })}>
            {b.label} ({statusCounts[b.key]})
          </Chip>
        ))}
      </div>

      {renderModes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-faint">Rendered</span>
          <Chip active={rendered === null} onClick={() => updateParams({ rendered: null })}>
            All
          </Chip>
          {renderModes.map((r) => (
            <Chip key={r} active={rendered === r} onClick={() => updateParams({ rendered: rendered === r ? null : r })}>
              {r}
            </Chip>
          ))}
        </div>
      )}

      {depths.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-faint">Depth</span>
          <Chip active={depth === null} onClick={() => updateParams({ depth: null })}>
            All
          </Chip>
          {depths.map((d) => (
            <Chip key={d} active={depth === d} onClick={() => updateParams({ depth: depth === d ? null : String(d) })}>
              {d}
            </Chip>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={grouped} onClick={() => updateParams({ group: grouped ? null : "1" })}>
          Group by section
        </Chip>
        {sectionFilter && (
          <Chip dot="ok" onClick={() => updateParams({ section: null })}>
            Section: {sectionFilter}
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </Chip>
        )}
      </div>

      <p className="text-xs text-secondary">
        {filtered.length} of {rows.length} row{rows.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No rows match these filters" />
      ) : grouped ? (
        <div className="space-y-3">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.section);
            return (
              <div key={g.section} className="overflow-hidden rounded-card border border-border bg-card">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(g.section)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between gap-3 bg-subtle px-4 py-2.5 text-left outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex items-center gap-2">
                    <ChevronRight
                      size={14}
                      strokeWidth={2}
                      className={cn("text-faint transition-transform duration-150 ease-out", !isCollapsed && "rotate-90")}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium text-foreground">{g.section}</span>
                    <span className="text-xs tabular-nums text-faint">({g.items.length})</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    {Object.entries(g.statusMix).map(([bucket, count]) => (
                      <Badge key={bucket} tone={bucketBadgeTone(bucket as StatusBucket)}>
                        {bucket} {count}
                      </Badge>
                    ))}
                  </span>
                </button>
                {!isCollapsed && (
                  <TableContainer className="rounded-none border-0 border-t border-border">
                    {tableHead}
                    <tbody>{g.items.map(renderRow)}</tbody>
                  </TableContainer>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <TableContainer>
            {tableHead}
            <tbody>{visibleRows.map(renderRow)}</tbody>
          </TableContainer>

          {visible < filtered.length && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, filtered.length - visible)} more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
