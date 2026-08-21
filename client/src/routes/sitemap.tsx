import { Link } from "react-router-dom";
import { History, Map as MapIcon } from "lucide-react";
import { useCurrentRun } from "@/api/current-run";
import { useRun } from "@/api/crawls";
import { usePages } from "@/api/pages";
import { useAiAccess } from "@/api/sitemap";
import { findPageIdByUrl } from "@/lib/data-explorer";
import { findRuleSourceLine } from "@/lib/sitefiles-lines";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import { Badge } from "@/components/ui/badge";
import { RobotsPanel } from "@/components/sitemap/robots-panel";
import { LlmsPanel } from "@/components/sitemap/llms-panel";
import { AiCrawlerHeadline, AiCrawlerTable } from "@/components/sitemap/ai-crawler-table";
import { FailuresSections } from "@/components/sitemap/failures-sections";
import type { CrawledPageWithId } from "@/lib/data";

function CrossRefList({
  title,
  urls,
  runId,
  pages,
  tone,
  noLinkLabel,
}: {
  title: string;
  urls: string[];
  runId: string;
  pages: CrawledPageWithId[];
  tone: "warn" | "danger" | "neutral";
  noLinkLabel: string;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Badge tone={tone}>{urls.length}</Badge>
      </div>
      {urls.length === 0 ? (
        <p className="text-sm text-faint">None.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
          {urls.map((url) => {
            const pageId = findPageIdByUrl(pages, url);
            return (
              <li key={url} className="flex items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                {pageId ? (
                  <Link to={`/pages/${pageId}?run=${encodeURIComponent(runId)}`} className="truncate text-primary underline underline-offset-2">
                    {url}
                  </Link>
                ) : (
                  <>
                    <span className="truncate text-secondary">{url}</span>
                    <span className="shrink-0 whitespace-nowrap rounded-pill bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">
                      {noLinkLabel}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Sitemap / robots / AI-crawler access + failures. Old: app/sitemap/page.tsx. */
export function SitemapRoute() {
  const { runId, runsLoading } = useCurrentRun();
  const runQuery = useRun(runId);
  const pagesQuery = usePages(runId);
  const aiAccessQuery = useAiAccess(runId);

  if (runsLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see robots.txt and sitemap evidence here." />;
  }
  if (runQuery.isLoading || pagesQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;
  if (runQuery.error) {
    return <EmptyState icon={MapIcon} title="Couldn’t load run" description={(runQuery.error as Error).message} />;
  }

  const detail = runQuery.data;
  const robots = detail?.robots ?? null;
  const sitemaps = detail?.sitemaps ?? null;
  const report = detail?.report ?? null;
  const blocked = detail?.blocked ?? [];
  const failures = detail?.failures ?? [];
  const skipped = detail?.skipped ?? [];
  const pages = pagesQuery.data ?? [];
  const aiAccess = aiAccessQuery.data ?? null;

  if (!robots && !sitemaps && failures.length === 0 && blocked.length === 0 && skipped.length === 0) {
    return <EmptyState icon={MapIcon} title="No robots/sitemap evidence for this run" />;
  }

  const rows = aiAccess?.rows ?? [];
  const robotsAvailable = Boolean(robots?.content && robots.parseStatus === "ok");

  const sourceLines = new Map<string, number | null>();
  if (robotsAvailable && robots?.content) {
    for (const r of rows) {
      const ruleType: "allow" | "disallow" | null =
        r.verdict === "allowed" && r.allowRules[0]
          ? "allow"
          : r.verdict === "blocked" || r.verdict === "partly-blocked"
            ? "disallow"
            : null;
      const rulePath = ruleType === "allow" ? r.allowRules[0] ?? null : ruleType === "disallow" ? r.disallowRules[0] ?? null : null;
      sourceLines.set(r.agent, findRuleSourceLine(robots.content, r.matchedGroup, rulePath, ruleType));
    }
  }

  const llms = robots?.llmsTxt;
  const llmsTxt = llms
    ? {
        available: true,
        present: llms.present,
        url: llms.url,
        statusCode: llms.statusCode,
        bytes: llms.bytes,
        fetchedAt: llms.fetchedAt,
        content: llms.content ?? null,
        reason: llms.present
          ? llms.content
            ? null
            : "Fetched by this run's crawler, but that crawler version did not store the file body."
          : `llms.txt not found — HTTP ${llms.statusCode ?? "error"}.`,
      }
    : { available: false, reason: "llms.txt was not probed for this run (robots.json carries no llmsTxt field — crawler version predates llms.txt probing)." };

  return (
    <div className="space-y-6">
      {report && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <StatValue value={report.sitemap.urlsInSitemap} caption="URLs in sitemap" />
          </Card>
          <Card>
            <StatValue value={report.sitemap.inSitemapNotCrawled.length} caption="In sitemap, not crawled" />
          </Card>
          <Card>
            <StatValue value={report.sitemap.crawledNotInSitemap.length} caption="Crawled, not in sitemap" />
          </Card>
        </div>
      )}

      <AiCrawlerHeadline rows={rows} />

      <AiCrawlerTable rows={rows} sourceLines={sourceLines} robotsAvailable={robotsAvailable} />

      {aiAccess && aiAccess.parseStatus !== "ok" && (
        <p className="text-xs text-faint">
          robots.txt parse status: <span className="font-medium text-foreground">{aiAccess.parseStatus}</span> — verdicts above fell back to &quot;unknown&quot; rather than guessing.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RobotsPanel robots={robots} sitemapCount={robots?.sitemaps.length ?? 0} />
        <LlmsPanel llmsTxt={llmsTxt} />
      </div>

      {sitemaps && sitemaps.files.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Sitemap files</h2>
            <span className="text-xs tabular-nums text-faint">{sitemaps.entries.length} total entries</span>
          </div>
          <ul className="space-y-1.5 text-xs">
            {sitemaps.files.map((f) => (
              <li key={f.url} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                <span className="truncate text-secondary">{f.url}</span>
                <span className="shrink-0 tabular-nums text-faint">
                  {f.kind} · {f.urlCount} url{f.urlCount === 1 ? "" : "s"} ·{" "}
                  {f.error ? <Badge tone="danger">{f.statusCode ?? "error"}</Badge> : (f.statusCode ?? "—")}
                </span>
              </li>
            ))}
          </ul>
          {sitemaps.errors.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-danger">
              {sitemaps.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {report && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <CrossRefList title="In sitemap, not crawled" urls={report.sitemap.inSitemapNotCrawled} runId={runId} pages={pages} tone="warn" noLinkLabel="never crawled" />
          <CrossRefList title="Crawled, not in sitemap" urls={report.sitemap.crawledNotInSitemap} runId={runId} pages={pages} tone="neutral" noLinkLabel="no page match" />
          <CrossRefList title="Sitemap entries failed" urls={report.sitemap.sitemapEntriesFailed} runId={runId} pages={pages} tone="danger" noLinkLabel="never crawled" />
        </div>
      )}

      <FailuresSections runId={runId} failures={failures} blocked={blocked} skipped={skipped} pages={pages} />
    </div>
  );
}
