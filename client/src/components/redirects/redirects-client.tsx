import { useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Search, GitBranch } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import type { RedirectRow, RedirectType } from "@/lib/data-redirects";

const PAGE_SIZE = 100;
const TYPES: RedirectType[] = ["permanent", "temporary", "loop", "to-error"];
const TYPE_TONE: Record<RedirectType, "ok" | "warn" | "danger" | "neutral"> = {
  permanent: "neutral",
  temporary: "warn",
  loop: "danger",
  "to-error": "danger",
};

export function RedirectsClient({ rows, runId }: { rows: RedirectRow[]; runId: string }) {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const type = TYPES.includes(searchParams.get("type") as RedirectType) ? (searchParams.get("type") as RedirectType) : null;
  const crossHostOnly = searchParams.get("crossHost") === "1";
  const toHttpsOnly = searchParams.get("toHttps") === "1";
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

  const counts = useMemo(() => {
    const c: Record<RedirectType, number> = { permanent: 0, temporary: 0, loop: 0, "to-error": 0 };
    let crossHost = 0,
      toHttps = 0;
    for (const r of rows) {
      c[r.type]++;
      if (r.crossHost) crossHost++;
      if (r.toHttps) toHttps++;
    }
    return { ...c, crossHost, toHttps };
  }, [rows]);

  const filtered = useMemo(() => {
    let items = rows;
    if (type) items = items.filter((r) => r.type === type);
    if (crossHostOnly) items = items.filter((r) => r.crossHost);
    if (toHttpsOnly) items = items.filter((r) => r.toHttps);
    if (qInput.trim()) {
      const needle = qInput.trim().toLowerCase();
      items = items.filter((r) => r.requestedUrl.toLowerCase().includes(needle) || (r.finalUrl ?? "").toLowerCase().includes(needle));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    items = [...items].sort((a, b) => (a.hops - b.hops) * dir);
    return items;
  }, [rows, type, crossHostOnly, toHttpsOnly, qInput, sortDir]);

  const visibleRows = filtered.slice(0, visible);

  function toggleHopsSort() {
    updateParams({ dir: sortDir === "desc" ? "asc" : "desc" });
  }

  return (
    <div className="space-y-4">
      <div className="flex h-9 max-w-md items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
        <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
        <input
          type="search"
          value={qInput}
          onChange={(e) => handleQChange(e.target.value)}
          placeholder="Search requested or final URL..."
          aria-label="Search redirects"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Type</span>
        <Chip active={type === null} onClick={() => updateParams({ type: null })}>
          All ({rows.length})
        </Chip>
        {TYPES.map((t) => (
          <Chip key={t} active={type === t} onClick={() => updateParams({ type: type === t ? null : t })}>
            {t} ({counts[t]})
          </Chip>
        ))}
        <Chip active={crossHostOnly} onClick={() => updateParams({ crossHost: crossHostOnly ? null : "1" })}>
          Cross-host ({counts.crossHost})
        </Chip>
        <Chip active={toHttpsOnly} onClick={() => updateParams({ toHttps: toHttpsOnly ? null : "1" })}>
          http→https ({counts.toHttps})
        </Chip>
      </div>

      <p className="text-xs text-secondary">
        {filtered.length} of {rows.length} redirect{rows.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={GitBranch} title="No redirects match these filters" />
      ) : (
        <>
          <TableContainer>
            <TableHead>
              <Th>Requested URL</Th>
              <Th sortDir={sortDir} onSort={toggleHopsSort}>
                Hops
              </Th>
              <Th>Final URL</Th>
              <Th>Final status</Th>
              <Th>Type</Th>
              <Th>Flags</Th>
            </TableHead>
            <tbody>
              {visibleRows.map((row) => (
                <Tr key={row.pageId}>
                  <Td className="max-w-xs truncate normal-case">{row.requestedUrl}</Td>
                  <Td className="tabular-nums">{row.hops}</Td>
                  <Td className="max-w-xs truncate normal-case">
                    {row.finalUrl ? (
                      <Link to={`/pages/${row.pageId}?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2">
                        {row.finalUrl}
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Td>
                  <Td>{row.finalStatus ?? <span className="text-faint">—</span>}</Td>
                  <Td className="normal-case">
                    <Badge tone={TYPE_TONE[row.type]}>{row.type}</Badge>
                  </Td>
                  <Td className="normal-case">
                    <div className="flex gap-1">
                      {row.crossHost && <Badge tone="warn">cross-host</Badge>}
                      {row.toHttps && <Badge tone="ok">→https</Badge>}
                    </div>
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
