import { useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Search, ImageOff, Download } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { ImageThumb } from "@/components/explorer/image-thumb";
import { exportToCsv } from "@/lib/export-csv";
import type { ImageRow, AltState } from "@/lib/data-images";

const PAGE_SIZE = 100;
type SortKey = "usage" | "url";
const ALT_STATES: AltState[] = ["missing", "empty", "described"];
const ALT_LABEL: Record<AltState, string> = { missing: "Missing alt", empty: "Empty alt", described: "Described" };
const ALT_TONE: Record<AltState, "danger" | "warn" | "ok"> = { missing: "danger", empty: "warn", described: "ok" };

export function ImagesClient({ rows, runId }: { rows: ImageRow[]; runId: string }) {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const altState = ALT_STATES.includes(searchParams.get("alt") as AltState) ? (searchParams.get("alt") as AltState) : null;
  const noDims = searchParams.get("dims") === "missing";
  const sizeFilter = searchParams.get("size"); // "oversized" | "large"
  const sortKey = (searchParams.get("sort") === "url" ? "url" : "usage") as SortKey;
  const sortDir = searchParams.get("dir") === "asc" ? "asc" : "desc";

  const [qInput, setQInput] = useState(urlQ);
  const [syncedUrlQ, setSyncedUrlQ] = useState(urlQ);
  if (urlQ !== syncedUrlQ) {
    setSyncedUrlQ(urlQ);
    setQInput(urlQ);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    navigate(`${pathname}?${next.toString()}`, { replace: true });
    setVisible(PAGE_SIZE);
  }

  function handleQChange(value: string) {
    setQInput(value);
    setVisible(PAGE_SIZE);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: value || null }), 250);
  }

  function toggleSort(key: SortKey) {
    if (sortKey !== key) updateParams({ sort: key, dir: "desc" });
    else if (sortDir === "desc") updateParams({ sort: key, dir: "asc" });
    else updateParams({ sort: null, dir: null });
  }

  const counts = useMemo(() => {
    const c: Record<AltState, number> = { missing: 0, empty: 0, described: 0 };
    let noDimsCount = 0;
    let oversizedCount = 0;
    let largeCount = 0;
    for (const r of rows) {
      c[r.altState]++;
      if (!r.hasDimensions) noDimsCount++;
      if (r.sizeCategory === "oversized") oversizedCount++;
      if (r.sizeCategory === "large") largeCount++;
    }
    return { ...c, noDimsCount, oversizedCount, largeCount };
  }, [rows]);

  const filtered = useMemo(() => {
    let items = rows;
    if (altState) items = items.filter((r) => r.altState === altState);
    if (noDims) items = items.filter((r) => !r.hasDimensions);
    if (sizeFilter === "oversized") items = items.filter((r) => r.sizeCategory === "oversized");
    if (sizeFilter === "large") items = items.filter((r) => r.sizeCategory === "large" || r.sizeCategory === "oversized");
    if (qInput.trim()) {
      const needle = qInput.trim().toLowerCase();
      items = items.filter((r) => r.url.toLowerCase().includes(needle) || (r.alt ?? "").toLowerCase().includes(needle));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    items = [...items].sort((a, b) => (sortKey === "url" ? a.url.localeCompare(b.url) * dir : (a.usageCount - b.usageCount) * dir));
    return items;
  }, [rows, altState, noDims, sizeFilter, qInput, sortKey, sortDir]);

  const visibleRows = filtered.slice(0, visible);

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return "—";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  function handleExportCsv() {
    exportToCsv(
      `images-${runId}`,
      filtered as unknown as Record<string, unknown>[],
      [
        { key: "url", label: "Image URL" },
        { key: "alt", label: "Alt Text" },
        { key: "altState", label: "Alt State" },
        { key: (r) => (r.hasDimensions ? `${r.width}x${r.height}` : "missing"), label: "Dimensions" },
        { key: "sizeBytes", label: "File Size (bytes)" },
        { key: "sizeCategory", label: "Size Category" },
        { key: "format", label: "Format" },
        { key: "usageCount", label: "Usage Count" },
      ]
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-9 w-full max-w-md items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
          <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => handleQChange(e.target.value)}
            placeholder="Search image URL or alt text..."
            aria-label="Search images"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          className="gap-1.5 h-9"
          title="Export current filtered images to CSV"
        >
          <Download size={14} /> Export CSV ({filtered.length})
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Alt text</span>
        <Chip active={altState === null && !sizeFilter && !noDims} onClick={() => updateParams({ alt: null, dims: null, size: null })}>
          All ({rows.length})
        </Chip>
        {ALT_STATES.map((s) => (
          <Chip key={s} active={altState === s} onClick={() => updateParams({ alt: altState === s ? null : s })}>
            {ALT_LABEL[s]} ({counts[s]})
          </Chip>
        ))}
        <Chip active={noDims} onClick={() => updateParams({ dims: noDims ? null : "missing" })}>
          No dimensions ({counts.noDimsCount})
        </Chip>
        <span className="ml-2 text-xs font-medium uppercase tracking-wide text-faint">Size</span>
        <Chip active={sizeFilter === "oversized"} onClick={() => updateParams({ size: sizeFilter === "oversized" ? null : "oversized" })}>
          Oversized &gt; 500KB ({counts.oversizedCount})
        </Chip>
        <Chip active={sizeFilter === "large"} onClick={() => updateParams({ size: sizeFilter === "large" ? null : "large" })}>
          Large &gt; 100KB ({counts.largeCount + counts.oversizedCount})
        </Chip>
      </div>

      <p className="text-xs text-secondary">
        {filtered.length} of {rows.length} unique image{rows.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={ImageOff} title="No images match these filters" />
      ) : (
        <>
          <TableContainer>
            <TableHead>
              <Th className="w-16">Preview</Th>
              <Th sortDir={sortKey === "url" ? sortDir : null} onSort={() => toggleSort("url")}>
                Image URL & Alt
              </Th>
              <Th>Alt state</Th>
              <Th>Dimensions</Th>
              <Th>Size</Th>
              <Th>Format</Th>
              <Th sortDir={sortKey === "usage" ? sortDir : null} onSort={() => toggleSort("usage")}>
                Used on
              </Th>
              <Th>First pages</Th>
            </TableHead>
            <tbody>
              {visibleRows.map((row) => (
                <Tr key={row.key}>
                  <Td className="w-16 py-2 shrink-0">
                    <ImageThumb src={row.url} alt={row.alt ?? ""} />
                  </Td>
                  <Td className="max-w-sm normal-case">
                    <div className="flex flex-col gap-1 min-w-0">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2 truncate font-mono text-xs"
                        title={row.url}
                      >
                        {row.url}
                      </a>
                      {row.alt ? (
                        <span className="text-xs text-secondary truncate" title={row.alt}>
                          alt: <span className="text-foreground">&quot;{row.alt}&quot;</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-faint italic">no alt text</span>
                      )}
                    </div>
                  </Td>
                  <Td className="normal-case">
                    <Badge tone={ALT_TONE[row.altState]}>{ALT_LABEL[row.altState]}</Badge>
                  </Td>
                  <Td>{row.hasDimensions ? `${row.width}×${row.height}` : <span className="text-faint">—</span>}</Td>
                  <Td className="normal-case">
                    {row.sizeBytes ? (
                      <Badge tone={row.sizeCategory === "oversized" ? "danger" : row.sizeCategory === "large" ? "warn" : "neutral"}>
                        {formatBytes(row.sizeBytes)}
                      </Badge>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Td>
                  <Td className="normal-case">{row.format ?? <span className="text-faint">—</span>}</Td>
                  <Td className="tabular-nums">{row.usageCount}</Td>
                  <Td className="max-w-xs truncate normal-case">
                    {row.pages.slice(0, 2).map((p, i) => (
                      <span key={`${p.pageId}-${i}`}>
                        {i > 0 && ", "}
                        <Link to={`/pages/${p.pageId}?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2">
                          {p.url}
                        </Link>
                      </span>
                    ))}
                  </Td>
                </Tr>
              ))}
            </tbody>
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
