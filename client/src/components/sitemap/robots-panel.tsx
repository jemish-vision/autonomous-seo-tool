import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RobotsEvidence } from "@/lib/types";

/** robots.txt evidence card. Lives on /sitemap (Sitemap & Robots) — merged here from the former
 *  "What the site tells crawlers" screen, which used to cross-link back to /sitemap for full
 *  sitemap coverage; that link became self-referential once this panel moved onto the sitemap
 *  page itself, so it was dropped (design-dna-v2 Law 1: no dead links). */
export function RobotsPanel({ robots, sitemapCount }: { robots: RobotsEvidence | null; sitemapCount?: number }) {
  if (!robots) {
    return (
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-foreground">robots.txt</h2>
        <p className="text-xs text-faint">robots.json not found for this run.</p>
      </Card>
    );
  }

  const lines = (robots.content ?? "").split(/\r?\n/);

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">robots.txt</h2>
        <Badge tone={robots.parseStatus === "ok" ? "ok" : robots.parseStatus === "error" ? "danger" : "neutral"}>{robots.parseStatus}</Badge>
      </div>
      <p className="mb-2 text-xs text-faint">
        {robots.url} · fetched {new Date(robots.fetchedAt).toLocaleString()}
        {typeof sitemapCount === "number" && ` · ${sitemapCount} sitemap declaration${sitemapCount === 1 ? "" : "s"}`}
      </p>
      {robots.content ? (
        <pre className="max-h-72 overflow-auto rounded-control border border-border bg-elevated p-3 font-mono text-xs text-secondary">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-7 shrink-0 select-none text-right text-faint">{i + 1}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line || " "}</span>
            </div>
          ))}
        </pre>
      ) : (
        <p className="text-xs text-faint">(no content)</p>
      )}
    </Card>
  );
}
