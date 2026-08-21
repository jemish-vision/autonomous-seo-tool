import { useSources } from "@/api/sources";
import { SourcesClient } from "@/components/sources/sources-client";

/** Sources / integrations. Old: app/sources/page.tsx (listSources -> SourcesClient). */
export function SourcesRoute() {
  const { data, isLoading } = useSources();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">Integrations</p>
        <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">Sources</h2>
        <p className="text-sm text-secondary">
          Connect WordPress, Shopify, or other CMS/e-commerce platforms to read and push SEO settings directly.
        </p>
      </header>

      {isLoading ? <p className="text-sm text-secondary">Loading…</p> : <SourcesClient initialSources={data ?? []} />}
    </div>
  );
}
