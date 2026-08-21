import { useEffect, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { GscMetricsResponse, GscInspectionRunResult, GscVerdict, GscBreakdownRow, GscPageMetric } from "./gsc-api";
import { crawlGscReason, inspectGscUrls } from "./gsc-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export type GscTab = "overview" | "indexing" | "pages" | "queries" | "segments";

export const GSC_TABS: Array<{ key: GscTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "indexing", label: "Indexing" },
  { key: "pages", label: "Pages" },
  { key: "queries", label: "Queries" },
  { key: "segments", label: "Devices & Countries" },
];

const VERDICT_LABEL: Record<GscVerdict, string> = {
  PASS: "Indexed",
  PARTIAL: "Indexed with issues",
  FAIL: "Not indexed",
  NEUTRAL: "Excluded",
  VERDICT_UNSPECIFIED: "Unknown",
};

const ROW_LIMIT = 100;

export function GscTabs({
  domain,
  data,
  tab,
  inspectResult,
  onInspect,
}: {
  domain: string;
  data: GscMetricsResponse;
  tab: GscTab;
  inspectResult: GscInspectionRunResult | null;
  onInspect: (result: GscInspectionRunResult) => void;
}) {
  if (tab === "indexing") {
    return <IndexingTab domain={domain} data={data} inspectResult={inspectResult} onInspect={onInspect} />;
  }

  if (!data.totals?.impressions) {
    return (
      <EmptyState
        icon={CircleAlert}
        title="No traffic data stored"
        description="This property has no impressions for the selected range. Hit Sync to pull the latest Search Console data."
      />
    );
  }

  return (
    <div className="space-y-4">
      {tab === "overview" && <Overview data={data} />}
      {tab === "pages" && (
        <FilteredTable
          placeholder="Filter by URL…"
          total={data.pages.length}
          noun="page"
          plural="pages"
          head="Page"
          rows={data.pages.map((p) => ({ key: p.pageUrl, label: p.pageUrl, href: p.pageUrl, clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position }))}
        />
      )}
      {tab === "queries" &&
        (data.queries.length === 0 ? (
          <EmptyState icon={CircleAlert} title="No query data stored" description="Re-run Sync — queries were added after your last sync." />
        ) : (
          <FilteredTable
            placeholder="Filter by search term…"
            total={data.queries.length}
            noun="query"
            plural="queries"
            head="Search query"
            rows={data.queries.map((q) => ({ key: q.keyValue, label: q.keyValue, clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: q.position }))}
          />
        ))}
      {tab === "segments" && <Segments devices={data.devices} countries={data.countries} />}
    </div>
  );
}

function Overview({ data }: { data: GscMetricsResponse }) {
  const t = data.totals!;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Clicks" value={t.clicks.toLocaleString()} />
        <Stat label="Impressions" value={t.impressions.toLocaleString()} />
        <Stat label="Average CTR" value={`${(t.ctr * 100).toFixed(2)}%`} />
        <Stat label="Average position" value={t.position.toFixed(1)} />
        <Stat label="Pages with traffic" value={t.pages.toLocaleString()} />
      </div>

      <TrendChart trend={data.trend} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MiniList
          title="Top pages"
          rows={data.pages.slice(0, 8).map((p) => ({ label: p.pageUrl, clicks: p.clicks, impressions: p.impressions }))}
        />
        <MiniList
          title="Top queries"
          rows={data.queries.slice(0, 8).map((q) => ({ label: q.keyValue, clicks: q.clicks, impressions: q.impressions }))}
          emptyHint="Re-sync to fetch queries."
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-subtle p-3">
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-faint">{label}</div>
    </div>
  );
}

/**
 * Daily clicks and impressions as an inline SVG. Each series is scaled to its
 * own maximum — a shared axis would flatten the clicks line into the baseline.
 */
function TrendChart({ trend }: { trend: GscMetricsResponse["trend"] }) {
  if (trend.length < 2) return null;

  const W = 900;
  const H = 150;
  const PAD = 4;
  const maxClicks = Math.max(...trend.map((d) => d.clicks), 1);
  const maxImpr = Math.max(...trend.map((d) => d.impressions), 1);
  const x = (i: number) => (i / (trend.length - 1)) * (W - PAD * 2) + PAD;
  const y = (v: number, max: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = (pick: (d: (typeof trend)[number]) => number, max: number) =>
    trend.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(d), max).toFixed(1)}`).join(" ");

  return (
    <div className="rounded-card border border-border bg-subtle p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-secondary">
        <span className="flex items-center gap-1.5">
          <i className="h-0.5 w-4 rounded-full bg-data-blue" aria-hidden="true" /> Impressions (peak {maxImpr.toLocaleString()})
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-0.5 w-4 rounded-full bg-data-orange" aria-hidden="true" /> Clicks (peak {maxClicks.toLocaleString()})
        </span>
        <span className="text-faint">each series scaled to its own peak</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-36 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Daily clicks and impressions from ${trend[0]?.date} to ${trend[trend.length - 1]?.date}`}
      >
        <path d={path((d) => d.impressions, maxImpr)} fill="none" stroke="var(--data-blue)" strokeWidth={2} />
        <path d={path((d) => d.clicks, maxClicks)} fill="none" stroke="var(--data-orange)" strokeWidth={2} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{trend[0]?.date}</span>
        <span>{trend[trend.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function MiniList({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: Array<{ label: string; clicks: number; impressions: number }>;
  emptyHint?: string;
}) {
  return (
    <div className="rounded-card border border-border bg-subtle p-3">
      <h3 className="mb-2 text-xs font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-faint">{emptyHint ?? "Nothing recorded."}</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-secondary" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums text-foreground">{r.clicks.toLocaleString()}</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-faint">{r.impressions.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface MetricRow {
  key: string;
  label: string;
  href?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

type SortKey = "clicks" | "impressions" | "ctr" | "position";

function MetricTable({ head, rows }: { head: string; rows: MetricRow[] }) {
  const [sort, setSort] = useState<SortKey>("clicks");
  const [offset, setOffset] = useState(0);
  // Reset pagination when the sort or the row set changes (derived state, no effect).
  const [prevResetKey, setPrevResetKey] = useState("");
  const resetKey = `${sort}|${rows.length}`;
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setOffset(0);
  }

  const sorted = useMemo(() => {
    const dir = sort === "position" ? 1 : -1;
    return [...rows].sort((a, b) => (a[sort] - b[sort]) * dir);
  }, [rows, sort]);

  const visible = sorted.slice(offset, offset + ROW_LIMIT);

  const header = (key: SortKey, label: string) => (
    <Th sortDir={sort === key ? (key === "position" ? "asc" : "desc") : null} onSort={() => setSort(key)}>
      {label}
    </Th>
  );

  return (
    <>
      <TableContainer>
        <TableHead>
          <Th>{head}</Th>
          {header("clicks", "Clicks")}
          {header("impressions", "Impressions")}
          {header("ctr", "CTR")}
          {header("position", "Position")}
        </TableHead>
        <tbody>
          {visible.map((r) => (
            <Tr key={r.key}>
              <Td className="max-w-md truncate normal-case">
                {r.href ? (
                  <a href={r.href} target="_blank" rel="noreferrer noopener" title={r.label} className="text-primary underline underline-offset-2">
                    {r.label}
                  </a>
                ) : (
                  <span title={r.label} className="text-foreground">
                    {r.label}
                  </span>
                )}
              </Td>
              <Td>{r.clicks.toLocaleString()}</Td>
              <Td>{r.impressions.toLocaleString()}</Td>
              <Td>{(r.ctr * 100).toFixed(2)}%</Td>
              <Td>{r.position.toFixed(1)}</Td>
            </Tr>
          ))}
        </tbody>
      </TableContainer>
      {rows.length === 0 && <p className="mt-2 text-xs text-faint">Nothing matches that filter.</p>}
      {rows.length > ROW_LIMIT && (
        <div className="mt-2 flex items-center justify-between text-xs text-faint">
          <span>
            Showing {offset + 1}–{Math.min(offset + ROW_LIMIT, rows.length)} of {rows.length.toLocaleString()}
          </span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - ROW_LIMIT))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + ROW_LIMIT >= rows.length} onClick={() => setOffset((o) => o + ROW_LIMIT)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function FilteredTable({
  placeholder,
  total,
  noun,
  plural,
  head,
  rows,
}: {
  placeholder: string;
  total: number;
  noun: string;
  plural: string;
  head: string;
  rows: MetricRow[];
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
  const filtering = q.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-secondary">
          {filtered.length.toLocaleString()} {filtered.length === 1 ? noun : plural}
          {filtering ? ` matching “${search.trim()}” of ${total.toLocaleString()}` : " with impressions"}
        </span>
        <div className="flex h-8 max-w-xs items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-faint outline-none"
          />
        </div>
      </div>
      <MetricTable head={head} rows={filtered} />
    </div>
  );
}

function Segments({ devices, countries }: { devices: GscBreakdownRow[]; countries: GscBreakdownRow[] }) {
  if (devices.length === 0 && countries.length === 0) {
    return (
      <EmptyState icon={CircleAlert} title="No device or country data stored" description="Re-run Sync — these were added after your last sync." />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">Devices</h3>
        <MetricTable
          head="Device"
          rows={devices.map((d) => ({ key: d.keyValue, label: d.keyValue.toLowerCase(), clicks: d.clicks, impressions: d.impressions, ctr: d.ctr, position: d.position }))}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">Countries</h3>
        <MetricTable
          head="Country"
          rows={countries.map((c) => ({ key: c.keyValue, label: c.keyValue.toUpperCase(), clicks: c.clicks, impressions: c.impressions, ctr: c.ctr, position: c.position }))}
        />
      </div>
    </div>
  );
}

/* ==========================================================================
 * Indexing — URL Inspection: what Google actually did with each URL, and why.
 * ======================================================================== */

function IndexingTab({
  domain,
  data,
  inspectResult,
  onInspect,
}: {
  domain: string;
  data: GscMetricsResponse;
  inspectResult: GscInspectionRunResult | null;
  onInspect: (result: GscInspectionRunResult) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GscVerdict | "all">("all");
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  // Reset pagination when a filter changes (derived state, no effect — the codebase bans
  // set-state-in-effect, so this mirrors the original component's derived-state pattern).
  const [prevFilterKey, setPrevFilterKey] = useState("");
  const filterKey = `${filter}|${reasonFilter}|${search}`;
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setOffset(0);
  }

  const [targetedCrawlBusy, setTargetedCrawlBusy] = useState(false);
  const [targetedCrawl, setTargetedCrawl] = useState<{ runId: string; urlsQueued: number } | null>(null);

  async function inspect(batchSize: number) {
    setRunning(true);
    setError(null);
    try {
      const result = await inspectGscUrls(domain, batchSize);
      onInspect(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inspection failed.");
    } finally {
      setRunning(false);
    }
  }

  const byVerdict = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of data.coverage) counts[c.verdict] = (counts[c.verdict] ?? 0) + c.count;
    return counts;
  }, [data.coverage]);

  const gscIndexed = (byVerdict.PASS ?? 0) + (byVerdict.PARTIAL ?? 0);
  const gscNotIndexed = (byVerdict.FAIL ?? 0) + (byVerdict.NEUTRAL ?? 0);

  const reasons = useMemo(
    () => [...data.coverage].filter((c) => c.coverageState).sort((a, b) => b.count - a.count).slice(0, 12),
    [data.coverage],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.inspections
      .filter((i) => filter === "all" || i.verdict === filter)
      .filter((i) => reasonFilter === null || i.coverageState === reasonFilter)
      .filter((i) => !q || i.pageUrl.toLowerCase().includes(q) || (i.coverageState ?? "").toLowerCase().includes(q));
  }, [data.inspections, filter, reasonFilter, search]);

  const visible = rows.slice(offset, offset + ROW_LIMIT);

  const selectedReason = reasons.find((reason) => reason.coverageState === reasonFilter) ?? null;
  const canCrawlSelectedReason = selectedReason?.verdict === "NEUTRAL" && rows.length > 0;

  async function crawlExcludedUrls() {
    if (reasonFilter === null || rows.length === 0) return;
    setTargetedCrawlBusy(true);
    setError(null);
    try {
      const result = await crawlGscReason(domain, reasonFilter, rows.map((row) => row.pageUrl));
      setTargetedCrawl(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not queue the targeted crawl.");
    } finally {
      setTargetedCrawlBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-secondary">
            <span>
              Inspected indexed: <strong className="text-foreground">{gscIndexed.toLocaleString()}</strong>{" "}
              <span className="text-faint">({(byVerdict.PASS ?? 0).toLocaleString()} clean + {(byVerdict.PARTIAL ?? 0).toLocaleString()} with issues)</span>
            </span>
            <span>
              Inspected not indexed: <strong className="text-foreground">{gscNotIndexed.toLocaleString()}</strong>{" "}
              <span className="text-faint">({(byVerdict.FAIL ?? 0).toLocaleString()} not indexed + {(byVerdict.NEUTRAL ?? 0).toLocaleString()} excluded)</span>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["PASS", "PARTIAL", "FAIL", "NEUTRAL"] as GscVerdict[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setFilter(filter === v ? "all" : v)}
                className={cn(
                  "rounded-control border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  filter === v ? "border-primary bg-primary text-primary-contrast" : "border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground",
                )}
              >
                <span className="tabular-nums">{byVerdict[v]?.toLocaleString() ?? 0}</span>{" "}
                <span className={filter === v ? "text-primary-contrast/80" : "text-faint"}>{VERDICT_LABEL[v]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => inspect(1000)} disabled={running}>
            {running ? "Inspecting…" : "Check 1000 URLs"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => inspect(2000)} disabled={running}>
            Check 2000
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {inspectResult && (
        <div className="rounded-card border border-border bg-subtle p-3 text-xs text-secondary">
          <p>
            Checked <strong className="text-foreground">{inspectResult.inspected}</strong> URL{inspectResult.inspected === 1 ? "" : "s"}
            {inspectResult.failed > 0 && <> · <strong className="text-foreground">{inspectResult.failed}</strong> failed</>} ·{" "}
            <strong className="text-foreground">{inspectResult.remaining.toLocaleString()}</strong> still unchecked
            {inspectResult.quotaDisagreement
              ? " · daily quota spent (Google's count, not ours)"
              : ` · ${inspectResult.quotaRemainingToday.toLocaleString()} of 2,000 daily inspections left`}
          </p>
          {inspectResult.stoppedReason && <p className="mt-1 text-warn">{inspectResult.stoppedReason}</p>}
        </div>
      )}

      {data.inspections.length === 0 && !running && (
        <div className="rounded-card border border-dashed border-border-strong bg-subtle p-4 text-xs text-secondary">
          <p>
            Nothing checked yet. Google&rsquo;s URL Inspection API tells you whether each page is actually indexed and, if not,
            the exact reason. It allows <strong className="text-foreground">2,000 URLs per day</strong> for this property, so it runs
            in batches — highest-traffic pages first, then pages your crawler found that Google has never sent traffic to.
          </p>
          {data.pages.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1.5 text-xs font-semibold text-foreground">Confirmed indexed — seen in Google search results</h4>
              <p className="mb-2 text-faint">
                {data.pages.length.toLocaleString()} URL{data.pages.length === 1 ? "" : "s"} appeared in search results during this date
                range, so Google has them indexed. This costs no inspection quota.
              </p>
              <ImpliedIndexTable pages={data.pages} />
            </div>
          )}
        </div>
      )}

      {reasons.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold text-foreground">Why Google decided that</h4>
          <TableContainer>
            <TableHead>
              <Th>Reason reported by Google</Th>
              <Th>Status</Th>
              <Th>URLs</Th>
            </TableHead>
            <tbody>
              {reasons.map((r) => (
                <Tr key={`${r.verdict}-${r.coverageState}`} className={cn(reasonFilter === r.coverageState && "bg-elevated")}>
                  <Td className="normal-case">
                    <button
                      type="button"
                      onClick={() => setReasonFilter(reasonFilter === r.coverageState ? null : r.coverageState)}
                      title={`Show URLs with: ${r.coverageState}`}
                      className="rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {r.coverageState}
                    </button>
                  </Td>
                  <Td>
                    <Badge tone={verdictTone(r.verdict)}>{VERDICT_LABEL[r.verdict]}</Badge>
                  </Td>
                  <Td>{r.count.toLocaleString()}</Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      )}

      {data.inspections.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-secondary">
              {rows.length.toLocaleString()} of {data.inspections.length.toLocaleString()} checked URL
              {data.inspections.length === 1 ? "" : "s"}
              {filter !== "all" && <> · {VERDICT_LABEL[filter]}</>}
              {reasonFilter !== null && <> · {reasonFilter}</>}
            </span>
            <div className="flex items-center gap-1.5">
              {reasonFilter !== null && (
                <Button variant="ghost" size="sm" onClick={() => setReasonFilter(null)}>
                  Clear reason filter
                </Button>
              )}
              {canCrawlSelectedReason && (
                <Button size="sm" onClick={crawlExcludedUrls} disabled={targetedCrawlBusy}>
                  {targetedCrawlBusy ? "Queuing crawl…" : `Crawl ${rows.length.toLocaleString()} URL${rows.length === 1 ? "" : "s"}`}
                </Button>
              )}
              <div className="flex h-8 max-w-xs items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by URL or reason…"
                  aria-label="Filter inspections"
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-faint outline-none"
                />
              </div>
            </div>
          </div>

          {targetedCrawl && <TargetedCrawlProgress runId={targetedCrawl.runId} urlsQueued={targetedCrawl.urlsQueued} />}

          <TableContainer>
            <TableHead>
              <Th>URL</Th>
              <Th>Status</Th>
              <Th>Reason</Th>
              <Th>Google&rsquo;s canonical</Th>
              <Th>Details</Th>
              <Th>Last crawled</Th>
            </TableHead>
            <tbody>
              {visible.map((i) => (
                <InspectionRow key={i.pageUrl} row={i} />
              ))}
            </tbody>
          </TableContainer>

          {rows.length > ROW_LIMIT && (
            <div className="flex items-center justify-between text-xs text-faint">
              <span>
                Showing {offset + 1}–{Math.min(offset + ROW_LIMIT, rows.length)} of {rows.length.toLocaleString()}
              </span>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - ROW_LIMIT))}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={offset + ROW_LIMIT >= rows.length} onClick={() => setOffset((o) => o + ROW_LIMIT)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function verdictTone(v: GscVerdict): "ok" | "warn" | "danger" | "neutral" {
  if (v === "PASS") return "ok";
  if (v === "PARTIAL") return "warn";
  if (v === "FAIL") return "danger";
  return "neutral";
}

function InspectionRow({ row }: { row: GscMetricsResponse["inspections"][number] }) {
  const canonicalMismatch = row.googleCanonical && row.userCanonical && row.googleCanonical !== row.userCanonical;
  return (
    <Tr>
      <Td className="max-w-md truncate normal-case">
        <a href={row.pageUrl} target="_blank" rel="noreferrer noopener" title={row.pageUrl} className="text-primary underline underline-offset-2">
          {row.pageUrl}
        </a>
      </Td>
      <Td>
        <Badge tone={verdictTone(row.verdict)}>{VERDICT_LABEL[row.verdict]}</Badge>
      </Td>
      <Td className="max-w-xs truncate normal-case text-secondary">
        <span title={row.coverageState ?? ""}>{row.coverageState ?? "—"}</span>
        {row.indexingState && row.indexingState !== "INDEXING_ALLOWED" && (
          <span className="block text-[10px] text-faint">{row.indexingState.replace(/_/g, " ").toLowerCase()}</span>
        )}
        {row.pageFetchState && row.pageFetchState !== "SUCCESSFUL" && (
          <span className="block text-[10px] text-faint">fetch: {row.pageFetchState.replace(/_/g, " ").toLowerCase()}</span>
        )}
      </Td>
      <Td className="normal-case text-secondary">
        {canonicalMismatch ? (
          <span className="text-warn" title={`Google chose ${row.googleCanonical}, page declares ${row.userCanonical}`}>
            differs
          </span>
        ) : !row.googleCanonical ? (
          <span className="text-faint">—</span>
        ) : !row.userCanonical ? (
          <span className="text-faint" title={`Page declares no canonical; Google chose ${row.googleCanonical}`}>
            none declared
          </span>
        ) : (
          <span className="text-faint">same</span>
        )}
      </Td>
      <Td>
        <InspectionDetails row={row} />
      </Td>
      <Td className="text-faint">{row.lastCrawlTime ? new Date(row.lastCrawlTime).toLocaleDateString() : "never"}</Td>
    </Tr>
  );
}

/**
 * Per-URL inspection details, expandable in place. Sitemaps, referring URLs and the rich
 * results / AMP / mobile usability verdicts come straight from Google's raw inspection payload;
 * the "Open in GSC" link jumps to the full report in Search Console.
 */
function InspectionDetails({ row }: { row: GscMetricsResponse["inspections"][number] }) {
  const raw = row.raw ?? {};
  const referringUrls = Array.isArray(raw.referringUrls) ? raw.referringUrls : [];
  const rich = (raw.richResults ?? null) as Record<string, unknown> | null;
  const amp = (raw.amp ?? null) as Record<string, unknown> | null;
  const mobile = (raw.mobileUsability ?? null) as Record<string, unknown> | null;
  const richVerdict = typeof rich?.verdict === "string" ? rich.verdict : null;
  const ampVerdict = typeof amp?.verdict === "string" ? amp.verdict : null;
  const mobileVerdict = typeof mobile?.verdict === "string" ? mobile.verdict : null;
  const sitemaps = row.sitemaps ?? [];
  const inspectionLink = typeof raw.inspectionResultLink === "string" ? raw.inspectionResultLink : null;

  const chips: string[] = [];
  if (richVerdict) chips.push(`Rich ${richVerdict.replace(/_/g, " ").toLowerCase()}`);
  if (ampVerdict) chips.push(`AMP ${ampVerdict.replace(/_/g, " ").toLowerCase()}`);
  if (mobileVerdict) chips.push(`Mobile ${mobileVerdict.replace(/_/g, " ").toLowerCase()}`);

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-secondary outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <span className="text-faint group-open:hidden">▸ details</span>
        <span className="hidden text-faint group-open:inline">▾ details</span>
      </summary>
      <div className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-secondary">
        <DetailList title="Sitemaps" values={sitemaps} />
        <DetailList title="Referring URLs" values={referringUrls.map(String)} />
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c} className="rounded-control border border-border bg-subtle px-1.5 py-0.5 text-faint">
                {c}
              </span>
            ))}
          </div>
        )}
        {rich && <JsonDetail title="Rich results" value={rich} />}
        {amp && <JsonDetail title="AMP" value={amp} />}
        {mobile && <JsonDetail title="Mobile usability" value={mobile} />}
        {inspectionLink && (
          <a
            href={inspectionLink}
            target="_blank"
            rel="noreferrer noopener"
            className="block text-primary underline underline-offset-2"
          >
            Open in GSC
          </a>
        )}
      </div>
    </details>
  );
}

function DetailList({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <span className="font-medium text-faint">{title}: </span>
      {values.length === 0 ? (
        <span className="text-faint">none reported</span>
      ) : (
        <ul className="ml-3 list-disc pl-3">
          {values.map((value) => (
            <li key={value} className="break-all">
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JsonDetail({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div>
      <span className="font-medium text-faint">{title}</span>
      <pre className="mt-0.5 overflow-x-auto rounded-control border border-border bg-subtle p-1.5 text-[10px] text-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Live progress for a targeted crawl spawned from the Indexing tab (polls the run's counters). */
function TargetedCrawlProgress({ runId, urlsQueued }: { runId: string; urlsQueued: number }) {
  const [status, setStatus] = useState<{ state: string; crawled: number | null; discovered: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const intervalId = setInterval(tick, 2000);

    async function tick() {
      try {
        const res = await fetch(`/api/crawls/${encodeURIComponent(runId)}/progress`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message ?? `Progress request failed with status ${res.status}`);
        }
        const data = (await res.json()) as { state: string; crawled: number | null; discovered: number | null };
        if (!cancelled) setStatus(data);
        if (data.state === "done" || data.state === "failed" || data.state === "cancelled") {
          clearInterval(intervalId);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load crawl progress.");
        clearInterval(intervalId);
      }
    }

    tick();
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [runId]);

  const pct =
    status && status.discovered != null && status.discovered > 0
      ? Math.min(100, Math.round(((status.crawled ?? 0) / status.discovered) * 100))
      : null;

  return (
    <div className="rounded-card border border-border bg-subtle p-3 text-xs text-secondary">
      <p>
        Targeted crawl running for <strong className="text-foreground">{urlsQueued.toLocaleString()}</strong> URL
        {urlsQueued === 1 ? "" : "s"}.{" "}
        <a href={`/runs?run=${encodeURIComponent(runId)}`} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
          View full progress
        </a>
      </p>
      {error && <p className="mt-1 text-danger">{error}</p>}
      {status && !error && status.state !== "done" && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-strong">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <span className="text-faint">
            {status.crawled ?? 0}
            {status.discovered != null ? `/${status.discovered}` : ""}
          </span>
        </div>
      )}
      {status?.state === "done" && <p className="mt-1 text-ok">Crawl completed — {status.crawled ?? 0} pages fetched.</p>}
    </div>
  );
}

function ImpliedIndexTable({ pages }: { pages: GscPageMetric[] }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  // Derived-state reset (see IndexingTab) — avoids the banned set-state-in-effect rule.
  const [prevQ, setPrevQ] = useState("");
  const q = search.trim().toLowerCase();
  if (q !== prevQ) {
    setPrevQ(q);
    setOffset(0);
  }
  const filtered = q ? pages.filter((p) => p.pageUrl.toLowerCase().includes(q)) : pages;
  const visible = filtered.slice(offset, offset + ROW_LIMIT);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-secondary">
          {filtered.length.toLocaleString()} shown{filtered.length !== pages.length ? ` of ${pages.length.toLocaleString()}` : ""}
        </span>
        <div className="flex h-8 max-w-xs items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by URL…"
            aria-label="Filter confirmed indexed URLs"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-faint outline-none"
          />
        </div>
      </div>
      <TableContainer>
        <TableHead>
          <Th>URL</Th>
          <Th>Status</Th>
          <Th>Impressions</Th>
          <Th>Clicks</Th>
        </TableHead>
        <tbody>
          {visible.map((p) => (
            <Tr key={p.pageUrl}>
              <Td className="max-w-md truncate normal-case">
                <a href={p.pageUrl} target="_blank" rel="noreferrer noopener" title={p.pageUrl} className="text-primary underline underline-offset-2">
                  {p.pageUrl}
                </a>
              </Td>
              <Td>
                <Badge tone="ok">Indexed</Badge>
              </Td>
              <Td>{p.impressions.toLocaleString()}</Td>
              <Td>{p.clicks.toLocaleString()}</Td>
            </Tr>
          ))}
        </tbody>
      </TableContainer>
      {filtered.length > ROW_LIMIT && (
        <div className="flex items-center justify-between text-xs text-faint">
          <span>
            Showing {offset + 1}–{Math.min(offset + ROW_LIMIT, filtered.length)} of {filtered.length.toLocaleString()}
          </span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - ROW_LIMIT))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + ROW_LIMIT >= filtered.length} onClick={() => setOffset((o) => o + ROW_LIMIT)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

