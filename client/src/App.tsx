import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/shell/app-shell";
import { LoginRoute } from "@/routes/login";
import { SignupRoute } from "@/routes/signup";

// Page routes (ported from the old app/ pages). Each is a client component that fetches through
// the api/* React Query hooks. See ROUTE MAP in README.
import { OverviewRoute } from "@/routes/overview";
import { RunsRoute } from "@/routes/runs";
import { PagesRoute } from "@/routes/pages";
import { PageDetailRoute } from "@/routes/page-detail";
import { PagePreviewRoute } from "@/routes/page-preview";
import { IssuesRoute } from "@/routes/issues";
import { SitemapRoute } from "@/routes/sitemap";
import { CompareRoute } from "@/routes/compare";
import { LinksRoute } from "@/routes/links";
import { ImagesRoute } from "@/routes/images";
import { RedirectsRoute } from "@/routes/redirects";
import { QueueRoute } from "@/routes/queue";
import { SourcesRoute } from "@/routes/sources";
import { GscRoute } from "@/routes/gsc";
import { NewCrawlRoute } from "@/routes/new-crawl";

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/signup" element={<SignupRoute />} />

      {/* Protected — everything under the app shell */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<OverviewRoute />} />
        <Route path="/runs" element={<RunsRoute />} />
        <Route path="/queue" element={<QueueRoute />} />
        <Route path="/issues" element={<IssuesRoute />} />
        <Route path="/sitemap" element={<SitemapRoute />} />
        <Route path="/gsc" element={<GscRoute />} />
        <Route path="/sources" element={<SourcesRoute />} />
        <Route path="/pages" element={<PagesRoute />} />
        <Route path="/pages/:id" element={<PageDetailRoute />} />
        <Route path="/pages/:id/preview" element={<PagePreviewRoute />} />
        <Route path="/links" element={<LinksRoute />} />
        <Route path="/images" element={<ImagesRoute />} />
        <Route path="/redirects" element={<RedirectsRoute />} />
        <Route path="/compare" element={<CompareRoute />} />
        <Route path="/new-crawl" element={<NewCrawlRoute />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
