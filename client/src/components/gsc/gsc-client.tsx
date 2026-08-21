import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, Unplug, Link2, Unlink, ExternalLink, Search } from "lucide-react";
import {
  getGscStatus,
  getGscProperties,
  getGscSites,
  getGscAuthUrl,
  getGscMetrics,
  linkGscProperty,
  unlinkGscProperty,
  disconnectGsc,
  syncGscMetrics,
  type GscSite,
  type GscStatus,
  type GscProperty,
  type GscMetricsResponse,
  type GscSyncResult,
  type GscInspectionRunResult,
} from "./gsc-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GscTabs, type GscTab, GSC_TABS } from "./tabs";
import { DateRangePicker, type Range } from "./date-range-picker";
import { cn } from "@/lib/cn";

export type GscTabKey = GscTab;

/** Messages the OAuth callback appends to the /gsc URL on its way back. */
const CALLBACK_MESSAGES: Record<string, { text: string; tone: "ok" | "warn" }> = {
  connected: { text: "Search Console connected.", tone: "ok" },
  denied: { text: "You declined the Google consent screen — nothing was connected.", tone: "warn" },
  invalid_state: { text: "That sign-in link had expired or didn't match this session. Start the connection again.", tone: "warn" },
  failed: { text: "Google rejected the connection. Check the redirect URI registered on your OAuth client matches exactly.", tone: "warn" },
};

export function GscClient({ sites, initialDomain }: { sites: GscSite[]; initialDomain: string | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<GscStatus | null>(null);
  const [properties, setProperties] = useState<GscProperty[]>([]);
  const [linkedByDomain, setLinkedByDomain] = useState<Map<string, string>>(new Map());
  const [selectedDomain, setSelectedDomain] = useState<string | null>(initialDomain ?? sites[0]?.domain ?? null);
  const [activeTab, setActiveTab] = useState<GscTab>("overview");
  const [callback, setCallback] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<GscMetricsResponse | null>(null);
  /** The domain the current `metrics` payload belongs to, so a stale payload
   *  from another selection is never rendered under the active site. */
  const [metricsDomain, setMetricsDomain] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [range, setRange] = useState<Range | null>(null);
  const [searchType, setSearchType] = useState<"web" | "image">("web");
  const [syncResult, setSyncResult] = useState<GscSyncResult | null>(null);
  const [inspectResult, setInspectResult] = useState<GscInspectionRunResult | null>(null);

  // Read the ?gsc=<outcome> callback banner once (derived state, keyed on the
  // outcome string so it can't loop), then strip the param from the URL.
  const outcome = searchParams.get("gsc");
  const [syncedOutcome, setSyncedOutcome] = useState<string | null>(null);
  if (outcome && outcome !== syncedOutcome) {
    setSyncedOutcome(outcome);
    setCallback(CALLBACK_MESSAGES[outcome] ?? null);
  }
  useEffect(() => {
    if (!outcome) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("gsc");
    navigate(`/gsc${next.toString() ? `?${next.toString()}` : ""}`, { replace: true });
  }, [outcome, searchParams, navigate]);

  const refreshStatus = useCallback(async () => {
    const next = await getGscStatus();
    setStatus(next);
    setLinkedByDomain(new Map());
    if (next.connected) {
      const [props, siteRows] = await Promise.all([getGscProperties(), getGscSites()]);
      setProperties(props.properties);
      const map = new Map<string, string>();
      for (const s of siteRows.sites) if (s.linkedSiteUrl) map.set(s.domain, s.linkedSiteUrl);
      setLinkedByDomain(map);
      // Keep the selection valid: prefer the previously selected domain.
      setSelectedDomain((prev) => prev && map.has(prev) ? prev : siteRows.sites[0]?.domain ?? prev);
    } else {
      setProperties([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGscStatus()
      .then(async (next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.connected) {
          const [props, siteRows] = await Promise.all([getGscProperties(), getGscSites()]);
          if (cancelled) return;
          setProperties(props.properties);
          const map = new Map<string, string>();
          for (const s of siteRows.sites) if (s.linkedSiteUrl) map.set(s.domain, s.linkedSiteUrl);
          setLinkedByDomain(map);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Search Console status.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const linkedSiteUrl = selectedDomain ? (linkedByDomain.get(selectedDomain) ?? null) : null;

  const rangeStart = range?.start;
  const rangeEnd = range?.end;

  // Fetch metrics whenever the selected domain / range / search type changes.
  useEffect(() => {
    if (!selectedDomain || !linkedSiteUrl) return;
    const domain = selectedDomain;
    let cancelled = false;
    async function load() {
      setMetricsLoading(true);
      setError(null);
      try {
        const res = await getGscMetrics(domain, rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : undefined, searchType);
        if (cancelled) return;
        setMetrics(res);
        setMetricsDomain(domain);
        setRange({ start: res.range.startDate, end: res.range.endDate });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Search Console data.");
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedDomain, linkedSiteUrl, rangeStart, rangeEnd, searchType]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      if (/invalidated this connection/i.test(message)) await refreshStatus().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect() {
    await run("connect", async () => {
      const { authUrl } = await getGscAuthUrl();
      // Full navigation, not a popup: Google blocks its consent screen in many embedded contexts.
      window.location.href = authUrl;
    });
  }

  async function handleDisconnect() {
    await run("disconnect", async () => {
      await disconnectGsc();
      await refreshStatus();
    });
  }

  async function handleLink(siteUrl: string) {
    if (!selectedDomain) return;
    await run(`link:${siteUrl}`, async () => {
      await linkGscProperty(selectedDomain, siteUrl);
      await refreshStatus();
    });
  }

  async function handleUnlink() {
    if (!selectedDomain) return;
    await run(`unlink:${selectedDomain}`, async () => {
      await unlinkGscProperty(selectedDomain);
      await refreshStatus();
    });
  }

  async function handleSync() {
    if (!selectedDomain) return;
    await run(`sync:${selectedDomain}`, async () => {
      const result = await syncGscMetrics(selectedDomain);
      setSyncResult(result);
      await refreshStatus();
    });
  }

  const selectedSite = useMemo(() => sites.find((s) => s.domain === selectedDomain) ?? null, [sites, selectedDomain]);

  if (!status) {
    return (
      <Card>
        <p className="text-sm text-secondary">Loading Search Console status…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Connection card */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Google Search Console</h2>
            {status.connected ? (
              <Badge tone="ok">Connected</Badge>
            ) : status.configured ? (
              <Badge tone="warn">Not connected</Badge>
            ) : (
              <Badge tone="neutral">Not configured</Badge>
            )}
          </div>
          {status.connected && (
            <div className="flex items-center gap-2 text-xs text-secondary">
              <span className="text-faint">{status.connection?.googleEmail ?? "connected"}</span>
              <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={busy !== null}>
                <Unplug size={13} strokeWidth={2} aria-hidden="true" />
                Disconnect
              </Button>
            </div>
          )}
        </div>

        {!status.configured && (
          <p className="text-xs text-secondary">
            Not configured. {status.setupHint} Once connected, every crawled page can be ranked by the traffic it
            actually gets from Google.
          </p>
        )}

        {status.configured && !status.connected && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="max-w-xl text-xs text-secondary">
              Connect a Google account to pull clicks, impressions, CTR and average position for every crawled URL.
              Read-only — this can never change anything in your Search Console.
            </p>
            <Button size="sm" onClick={handleConnect} disabled={busy !== null}>
              {busy === "connect" ? "Opening Google…" : "Connect Search Console"}
            </Button>
          </div>
        )}

        {callback && (
          <p className={cn("mt-2 text-xs", callback.tone === "ok" ? "text-ok" : "text-warn")}>{callback.text}</p>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      {status.connected && (
        <>
          {/* Site picker + property link */}
          <Card>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-faint">Site</span>
                <select
                  value={selectedDomain ?? ""}
                  onChange={(e) => setSelectedDomain(e.target.value || null)}
                  className="h-9 rounded-control border border-border bg-subtle px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {sites.length === 0 && <option value="">No crawled sites yet</option>}
                  {sites.map((s) => (
                    <option key={s.domain} value={s.domain}>
                      {s.domain}
                    </option>
                  ))}
                </select>
                {selectedSite && (
                  <span className="text-xs text-faint">
                    {selectedSite.runCount} run{selectedSite.runCount === 1 ? "" : "s"}
                    {selectedSite.lastCrawledAt ? ` · last crawled ${new Date(selectedSite.lastCrawledAt).toLocaleDateString()}` : ""}
                  </span>
                )}
              </div>

              {selectedDomain && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {linkedSiteUrl ? (
                    <>
                      <span className="text-xs text-secondary">
                        Linked to <span className="font-medium text-foreground">{linkedSiteUrl}</span>
                      </span>
                      <Button variant="outline" size="sm" onClick={handleUnlink} disabled={busy !== null}>
                        <Unlink size={13} strokeWidth={2} aria-hidden="true" />
                        Unlink
                      </Button>
                      <Button size="sm" onClick={handleSync} disabled={busy !== null}>
                        <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
                        {busy === `sync:${selectedDomain}` ? "Syncing…" : "Sync"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-secondary">Link a Search Console property:</span>
                      {properties.length === 0 ? (
                        <span className="text-xs text-faint">
                          This Google account has no Search Console properties. Verify the site at{" "}
                          <a
                            href="https://search.google.com/search-console"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-primary underline underline-offset-2"
                          >
                            search.google.com/search-console
                          </a>{" "}
                          first, then reload.
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {properties
                            .filter((p) => !p.linkedDomain)
                            .map((p) => (
                              <Button
                                key={p.siteUrl}
                                variant={p.suggestedDomains.includes(selectedDomain) ? "primary" : "outline"}
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => handleLink(p.siteUrl)}
                                title={p.canReadData ? p.siteUrl : `${p.siteUrl} — ownership unverified, returns no data`}
                              >
                                <Link2 size={13} strokeWidth={2} aria-hidden="true" />
                                {p.siteUrl}
                                {!p.canReadData && <Badge tone="warn">unverified</Badge>}
                              </Button>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* Data tabs — only when a property is linked */}
      {linkedSiteUrl && selectedDomain ? (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-1" role="tablist" aria-label="Search Console data">
              {GSC_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    "rounded-control px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    activeTab === t.key ? "bg-elevated text-foreground shadow-sm" : "text-faint hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-control border border-border bg-subtle p-0.5" role="group" aria-label="Google Search type">
                {(["web", "image"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSearchType(type)}
                    className={cn(
                      "rounded-control px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      searchType === type ? "bg-elevated text-foreground shadow-sm" : "text-faint hover:text-foreground",
                    )}
                  >
                    {type === "web" ? "Web" : "Image search"}
                  </button>
                ))}
              </div>
              {metrics && (
                <DateRangePicker
                  value={range ?? { start: metrics.range.startDate, end: metrics.range.endDate }}
                  latestAvailable={metrics.range.latestAvailable}
                  busy={metricsLoading}
                  onChange={setRange}
                />
              )}
            </div>
          </div>

          <div className="p-4">
            {metrics?.range.clampedReason && (
              <p className="mb-2 text-xs text-warn">Adjusted: {metrics.range.clampedReason}.</p>
            )}
            {metrics?.partial && (
              <p className="mb-2 text-xs text-warn">
                Couldn&rsquo;t reach Google for this range — showing stored data only, which may not cover the whole period.
              </p>
            )}
            {metrics && (
              <p className="mb-2 text-xs text-faint">
                Fresh data from {metrics.range.provisionalStart} to {metrics.range.endDate} is provisional and may be restated by Google.
              </p>
            )}
            {syncResult && (
              <p className="mb-2 text-xs text-ok">
                Synced <strong>{syncResult.siteUrl}</strong>: {syncResult.pages} pages · {syncResult.totalClicks.toLocaleString()} clicks ·{" "}
                {syncResult.totalImpressions.toLocaleString()} impressions ({syncResult.startDate} to {syncResult.endDate}).
              </p>
            )}

            {metricsLoading && <p className="text-xs text-secondary">Loading {range ? `${range.start} to ${range.end}` : "Search Console data"}…</p>}

            {!metricsLoading && metrics && metricsDomain === selectedDomain && (
              <GscTabs
                domain={selectedDomain}
                data={metrics}
                tab={activeTab}
                onInspect={async (result) => {
                  setInspectResult(result);
                  try {
                    const res = await getGscMetrics(selectedDomain, rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : undefined, searchType);
                    setMetrics(res);
                  } catch {
                    // ignore
                  }
                }}
                inspectResult={inspectResult}
              />
            )}

            {!metricsLoading && (!metrics || metricsDomain !== selectedDomain) && linkedSiteUrl && (
              <EmptyState
                icon={Search}
                title="No data stored yet"
                description="Hit Sync on the card above to pull this property's Search Console metrics for the first time."
              />
            )}
          </div>
        </Card>
      ) : (
        status.connected &&
        selectedDomain && (
          <Card>
            <EmptyState
              icon={Link2}
              title="No Search Console property linked"
              description="Link one of your Google properties to this site above to see clicks, impressions and index status."
            />
          </Card>
        )
      )}

      {selectedDomain && linkedSiteUrl && (
        <p className="flex items-center gap-1.5 text-xs text-faint">
          <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
          <a
            href="https://search.google.com/search-console"
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            Open Search Console
          </a>{" "}
          — the authoritative source for this data.
        </p>
      )}
    </div>
  );
}
