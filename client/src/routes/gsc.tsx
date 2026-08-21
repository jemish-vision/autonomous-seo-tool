import { useSearchParams } from "react-router-dom";
import { History } from "lucide-react";
import { useGscSites } from "@/api/gsc";
import { GscClient } from "@/components/gsc/gsc-client";
import { EmptyState } from "@/components/ui/empty-state";

/** Search Console view, organised by crawled site. Old: app/gsc/page.tsx (listSites -> GscClient). */
export function GscRoute() {
  const [params] = useSearchParams();
  const site = params.get("site");
  const { data, isLoading } = useGscSites();

  if (isLoading) return <p className="text-sm text-secondary">Loading…</p>;

  const sites = data ?? [];
  if (sites.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No crawl runs yet"
        description="Run a crawl first — the Search Console view is organised by the sites you've crawled, and each one can be linked to a Google Search Console property."
      />
    );
  }

  // ?site= wins; otherwise default to the most recently crawled site.
  const initialDomain = site && sites.some((s) => s.domain === site) ? site : sites[0]?.domain ?? null;

  return <GscClient sites={sites} initialDomain={initialDomain} />;
}
