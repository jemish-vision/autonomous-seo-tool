import { useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Search, Link2, X } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { SlideOver } from "@/components/ui/slide-over";
import type { LinkRow } from "@/lib/data-links";

const PAGE_SIZE = 100;
type TypeFilter = "internal" | "external";
type StateFilter = "broken" | "nofollow" | "uncrawled";
type SortKey = "inbound" | "target" | "status";

function statusTone(row: LinkRow): "ok" | "warn" | "danger" | "neutral" {
  if (row.broken) return "danger";
  if (row.status === null) return "neutral";
  if (row.status >= 300) return "warn";
  return "ok";
}

export function LinksClient({ rows, runId, pageIdByTarget }: { rows: LinkRow[]; runId: string; pageIdByTarget: Record<string, string> }) {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const type = searchParams.get("type") === "internal" || searchParams.get("type") === "external" ? (searchParams.get("type") as TypeFilter) : null;
  const state = ["broken", "nofollow", "uncrawled"].includes(searchParams.get("state") ?? "") ? (searchParams.get("state") as StateFilter) : null;
  const sortKey = (["inbound", "target", "status"].includes(searchParams.get("sort") ?? "") ? searchParams.get("sort") : "inbound") as SortKey;
  const sortDir = searchParams.get("dir") === "asc" ? "asc" : "desc";

  const [qInput, setQInput] = useState(urlQ);
  const [syncedUrlQ, setSyncedUrlQ] = useState(urlQ);
  if (urlQ !== syncedUrlQ) {
    setSyncedUrlQ(urlQ);
    setQInput(urlQ);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [detail, setDetail] = useState<LinkRow | null>(null);

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
    let broken = 0,
      nofollow = 0,
      uncrawled = 0,
      internal = 0,
      external = 0;
    for (const r of rows) {
      if (r.broken) broken++;
      if (r.nofollowCount > 0) nofollow++;
      if (r.type === "internal" && !r.crawled) uncrawled++;
      if (r.type === "internal") internal++;
      else external++;
    }
    return { broken, nofollow, uncrawled, internal, external };
  }, [rows]);

  const filtered = useMemo(() => {
    let items = rows;
    if (type) items = items.filter((r) => r.type === type);
    if (state === "broken") items = items.filter((r) => r.broken);
    if (state === "nofollow") items = items.filter((r) => r.nofollowCount > 0);
    if (state === "uncrawled") items = items.filter((r) => r.type === "internal" && !r.crawled);
    if (qInput.trim()) {
      const needle = qInput.trim().toLowerCase();
      items = items.filter((r) => r.target.toLowerCase().includes(needle) || r.anchors.some((a) => a.toLowerCase().includes(needle)));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    items = [...items].sort((a, b) => {
      if (sortKey === "target") return a.target.localeCompare(b.target) * dir;
      if (sortKey === "status") return ((a.status ?? -1) - (b.status ?? -1)) * dir;
      return (a.inboundCount - b.inboundCount) * dir;
    });
    return items;
  }, [rows, type, state, qInput, sortKey, sortDir]);

  const visibleRows = filtered.slice(0, visible);

  return (
    <div className="space-y-4">
      <div className="flex h-9 max-w-md items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
        <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
        <input
          type="search"
          value={qInput}
          onChange={(e) => handleQChange(e.target.value)}
          placeholder="Search destination URL or anchor text..."
          aria-label="Search links"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Type</span>
        <Chip active={type === null} onClick={() => updateParams({ type: null })}>
          All ({rows.length})
        </Chip>
        <Chip active={type === "internal"} onClick={() => updateParams({ type: type === "internal" ? null : "internal" })}>
          Internal ({counts.internal})
        </Chip>
        <Chip active={type === "external"} onClick={() => updateParams({ type: type === "external" ? null : "external" })}>
          External ({counts.external})
        </Chip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">State</span>
        <Chip active={state === null} onClick={() => updateParams({ state: null })}>
          All
        </Chip>
        <Chip active={state === "broken"} onClick={() => updateParams({ state: state === "broken" ? null : "broken" })}>
          Broken ({counts.broken})
        </Chip>
        <Chip active={state === "nofollow"} onClick={() => updateParams({ state: state === "nofollow" ? null : "nofollow" })}>
          Nofollow ({counts.nofollow})
        </Chip>
        <Chip active={state === "uncrawled"} onClick={() => updateParams({ state: state === "uncrawled" ? null : "uncrawled" })}>
          Uncrawled ({counts.uncrawled})
        </Chip>
      </div>

      <p className="text-xs text-secondary">
        {filtered.length} of {rows.length} unique destination{rows.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={Link2} title="No links match these filters" />
      ) : (
        <>
          <TableContainer>
            <TableHead>
              <Th sortDir={sortKey === "target" ? sortDir : null} onSort={() => toggleSort("target")}>
                Destination
              </Th>
              <Th>Type</Th>
              <Th sortDir={sortKey === "status" ? sortDir : null} onSort={() => toggleSort("status")}>
                Status
              </Th>
              <Th sortDir={sortKey === "inbound" ? sortDir : null} onSort={() => toggleSort("inbound")}>
                Inbound
              </Th>
              <Th>Anchors</Th>
              <Th>&nbsp;</Th>
            </TableHead>
            <tbody>
              {visibleRows.map((row) => {
                const pageId = row.targetNormalized ? pageIdByTarget[row.targetNormalized] : undefined;
                return (
                  <Tr key={row.key}>
                    <Td className="max-w-md truncate normal-case">
                      {pageId ? (
                        <Link to={`/pages/${pageId}?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2">
                          {row.target}
                        </Link>
                      ) : (
                        <span className="text-foreground">{row.target}</span>
                      )}
                    </Td>
                    <Td className="normal-case">
                      <Badge tone={row.type === "internal" ? "neutral" : "warn"}>{row.type}</Badge>
                    </Td>
                    <Td>{row.status !== null ? <Badge tone={statusTone(row)}>{row.status}</Badge> : <span className="text-faint">—</span>}</Td>
                    <Td className="tabular-nums">{row.inboundCount}</Td>
                    <Td className="max-w-xs truncate normal-case text-secondary">{row.anchors.slice(0, 2).join(", ") || <span className="text-faint">—</span>}</Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => setDetail(row)}
                        className="whitespace-nowrap text-xs font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-control"
                      >
                        View sources ({row.inboundCount})
                      </button>
                    </Td>
                  </Tr>
                );
              })}
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

      <SlideOver open={detail !== null} onClose={() => setDetail(null)} title={detail ? `Sources · ${detail.inboundCount}` : "Sources"}>
        {detail && (
          <div className="space-y-2">
            <p className="mb-2 truncate text-xs text-secondary">{detail.target}</p>
            {detail.sources.map((s, i) => (
              <div key={i} className="rounded-control border border-border bg-subtle p-2.5 text-xs">
                <Link to={`/pages/${s.pageId}?run=${encodeURIComponent(runId)}`} className="truncate text-primary underline underline-offset-2 block">
                  {s.url}
                </Link>
                <div className="mt-1 flex items-center gap-1.5 text-faint">
                  <span>Anchor: {s.anchor || "(empty)"}</span>
                  {s.nofollow && <X size={11} strokeWidth={2} className="text-warn" aria-hidden="true" />}
                  {s.nofollow && <span className="text-warn">nofollow</span>}
                </div>
              </div>
            ))}
            {detail.inboundCount > detail.sources.length && (
              <p className="text-[11px] text-faint">Showing first {detail.sources.length} of {detail.inboundCount} sources.</p>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}
