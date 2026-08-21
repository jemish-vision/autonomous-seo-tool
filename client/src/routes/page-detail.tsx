import { Link, useParams, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { usePage, usePages } from "@/api/pages";
import { useArtifactStatus } from "@/api/artifacts";
import { useExplorerRows } from "@/api/explorer";
import { useIssues } from "@/api/issues";
import { useAiRecommendations, useAppliedFixes } from "@/api/issue-extras";
import { useCurrentRun } from "@/api/current-run";
import { findPageIdByUrl } from "@/lib/data-explorer";
import { findingsForPage } from "@/lib/data-issues";
import { recommendationsByRuleAndPage } from "@/lib/data-ai-recommendations";
import { filterAndSortRows, type ExplorerFilterParams, type SortKey, type StatusBucket } from "@/lib/explorer-shared";
import { EmptyState } from "@/components/ui/empty-state";
import {
  HeaderBand,
  CrawlPanel,
  MetadataPanel,
  HeadingsPanel,
  ImagesPanel,
  StructuredDataPanel,
  RedirectChainPanel,
  HeadersPanel,
} from "@/components/explorer/evidence-panels";
import { LinksPanel } from "@/components/explorer/links-panel";
import { MediaPanel } from "@/components/explorer/media-panel";
import { ContentPanel } from "@/components/explorer/collapsible-text";
import { PageActions } from "@/components/explorer/page-actions";
import { PageReplay } from "@/components/preview/page-replay";
import { frameability } from "@/components/preview/frameability";
import { pageHasRawHtml, pageHasStaticHtml } from "@/lib/page-artifacts";
import { PageIssuesPanel } from "@/components/issues/page-issues-panel";
import { AppliedFixesProvider } from "@/components/issues/applied-fixes-context";
import { SectionNav } from "@/components/explorer/section-nav";
import { BreadcrumbNav } from "@/components/explorer/breadcrumb-nav";
import { HeadMetadataPanel } from "@/components/page-detail/head-metadata-panel";
import { HeadIntegrityPanel } from "@/components/page-detail/head-integrity-panel";
import { FaviconsPanel } from "@/components/page-detail/favicons-panel";
import { FontsPanel } from "@/components/page-detail/fonts-panel";
import { SerpPreviewPanel } from "@/components/page-detail/serp-preview-panel";
import { DocumentStructurePanel } from "@/components/page-detail/document-structure-panel";
import type { ExtendedCrawledPage } from "@/components/page-detail/types";

const STATUS_VALUES: StatusBucket[] = ["2xx", "3xx", "4xx", "5xx", "failed", "blocked"];
const SORT_VALUES: SortKey[] = ["url", "status", "depth", "wordCount", "responseTime", "pagerank"];

/** Single page detail (evidence panels + prev/next). Old: app/pages/[id]/page.tsx.
 *
 *  The inline PageReplay panel renders when the page has captured raw HTML (see lib/page-artifacts).
 *  It fetches the captured HTML / screenshot as signed URLs from the authed blob endpoints and
 *  degrades to a graceful not-found state when a blob hasn't been synced to storage yet. */
export function PageDetailRoute() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const { runId } = useCurrentRun();

  const pageQuery = usePage(runId, id);
  const allRowsQuery = useExplorerRows(runId);
  const allPagesQuery = usePages(runId);
  const analysisQuery = useIssues(runId);
  const aiQuery = useAiRecommendations(runId);
  const appliedFixesQuery = useAppliedFixes(runId);
  const artifactStatus = useArtifactStatus();

  if (runId && pageQuery.isLoading) return <p className="text-sm text-secondary">Loading…</p>;

  const page = pageQuery.data ?? null;

  if (!page || !runId) {
    return (
      <EmptyState
        icon={FileText}
        title="Page record not found"
        description={
          <>
            No record for{" "}
            <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">{id}</code> under this run.{" "}
            <Link to="/pages" className="text-primary underline underline-offset-2">
              Back to Pages
            </Link>
          </>
        }
      />
    );
  }

  // Same filter context the list used, so "section" + Prev/Next stay inside what the user was viewing.
  const filterParams: ExplorerFilterParams = {
    q: sp.get("q") ?? null,
    status: STATUS_VALUES.includes(sp.get("status") as StatusBucket) ? (sp.get("status") as StatusBucket) : null,
    rendered: sp.get("rendered") === "http" || sp.get("rendered") === "playwright" ? (sp.get("rendered") as "http" | "playwright") : null,
    depth: sp.get("depth") !== null && sp.get("depth") !== "" ? Number(sp.get("depth")) : null,
    sort: SORT_VALUES.includes(sp.get("sort") as SortKey) ? (sp.get("sort") as SortKey) : null,
    dir: sp.get("dir") === "desc" ? "desc" : "asc",
    section: sp.get("section") ?? null,
  };

  const allRows = allRowsQuery.data ?? [];
  const allPages = allPagesQuery.data ?? [];
  const filtered = filterAndSortRows(allRows, filterParams).filter((r) => r.pageId !== null);
  const currentIndex = filtered.findIndex((r) => r.pageId === id);
  // Real PageRank for this page, sourced from the explorer rows (server computes it in the graph
  // pass). undefined when the graph hasn't loaded — HeaderBand then hides the PR badge.
  const pagerank = allRows.find((r) => r.pageId === id)?.pagerank ?? undefined;
  const parentPageId = page.crawl.parentUrl ? findPageIdByUrl(allPages, page.crawl.parentUrl) : null;

  // Raw-HTML replay + screenshot artifacts. Derived from the page record (see lib/page-artifacts);
  // the PageReplay panel degrades to a graceful not-found state if a blob isn't in storage yet.
  const hasRawHtml = pageHasRawHtml(page);
  const hasStaticHtml = pageHasStaticHtml(page);
  const frame = frameability(page.headers, page.url);

  const analysisReport = analysisQuery.data ?? null;
  const pageIssues = analysisReport ? findingsForPage(analysisReport, page.pageId) : [];
  const aiReport = aiQuery.data ?? null;
  const aiRecommendationsByRuleAndPage = aiReport ? recommendationsByRuleAndPage(aiReport) : null;
  const appliedFixes = appliedFixesQuery.data ?? [];

  const qs = new URLSearchParams();
  qs.set("run", runId);
  if (filterParams.q) qs.set("q", filterParams.q);
  if (filterParams.status) qs.set("status", filterParams.status);
  if (filterParams.rendered) qs.set("rendered", filterParams.rendered);
  if (filterParams.depth !== null) qs.set("depth", String(filterParams.depth));
  if (filterParams.sort) qs.set("sort", filterParams.sort);
  if (filterParams.dir === "desc") qs.set("dir", "desc");
  if (filterParams.section) qs.set("section", filterParams.section);
  const listQuery = `?${qs.toString()}`;

  const prevId = currentIndex > 0 ? filtered[currentIndex - 1].pageId : null;
  const nextId = currentIndex >= 0 && currentIndex < filtered.length - 1 ? filtered[currentIndex + 1].pageId : null;

  return (
    <div className="space-y-4 pb-8">
      <BreadcrumbNav
        url={page.url}
        runId={runId}
        listQuery={listQuery}
        prevHref={prevId ? `/pages/${prevId}` : null}
        nextHref={nextId ? `/pages/${nextId}` : null}
      />

      <HeaderBand
        page={page}
        runId={runId}
        pagerank={pagerank}
        actions={<PageActions page={page} runId={runId} hasRawHtml={hasRawHtml} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_180px]">
        <div className="min-w-0 space-y-4">
          <AppliedFixesProvider runId={runId} initial={appliedFixes}>
            <PageIssuesPanel
              issues={pageIssues}
              analyzed={Boolean(analysisReport)}
              runId={runId}
              pageId={page.pageId}
              aiRecommendationsByRuleAndPage={aiRecommendationsByRuleAndPage}
            />
          </AppliedFixesProvider>
          <SerpPreviewPanel title={page.title} metaDescription={page.metaDescription} url={page.url} />
          <MetadataPanel page={page} />
          <HeadMetadataPanel page={page as ExtendedCrawledPage} />
          <HeadIntegrityPanel page={page as ExtendedCrawledPage} />
          <FaviconsPanel page={page as ExtendedCrawledPage} />
          <FontsPanel page={page as ExtendedCrawledPage} />
          <HeadingsPanel page={page} />
          <DocumentStructurePanel page={page as ExtendedCrawledPage} />
          <LinksPanel links={page.links} />
          <ImagesPanel page={page} />
          <MediaPanel page={page} />
          <StructuredDataPanel page={page} />
          <ContentPanel text={page.content.text} wordCount={page.content.wordCount} contentHash={page.content.contentHash} />
          {hasRawHtml && (
            <div id="replay">
              <PageReplay
                runId={runId}
                pageId={page.pageId}
                pageUrl={page.url}
                statusCode={page.statusCode}
                fetchedAt={page.fetchedAt}
                hasStaticHtml={hasStaticHtml}
                canFrameLive={frame.canFrameLive}
                frameBlockedBy={frame.frameBlockedBy}
                hasScreenshot={Boolean(page.screenshot?.full)}
                artifactStorageConfigured={artifactStatus.data?.configured}
                artifactStorageReason={artifactStatus.data?.reason}
              />
            </div>
          )}
          <RedirectChainPanel page={page} />
          <HeadersPanel page={page} />
          <CrawlPanel page={page} runId={runId} parentPageId={parentPageId} />
        </div>
        <div className="order-first lg:order-last">
          <SectionNav />
        </div>
      </div>
    </div>
  );
}
