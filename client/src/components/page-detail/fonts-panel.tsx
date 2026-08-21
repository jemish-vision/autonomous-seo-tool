import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExtendedCrawledPage } from "./types";
import { SectionCard, Empty, NotCaptured } from "./section-helpers";

export function FontsPanel({ page }: { page: ExtendedCrawledPage }) {
  const fonts = page.fonts;

  if (fonts === undefined) {
    return (
      <SectionCard id="fonts" title="Fonts">
        <NotCaptured>Not captured in this run (re-crawl to capture @font-face declarations and third-party font hosts).</NotCaptured>
      </SectionCard>
    );
  }

  return (
    <SectionCard id="fonts" title="Fonts" count={`${fonts.faces.length} face(s) · ${fonts.thirdPartyHosts.length} third-party host(s)`}>
      <div className="space-y-4">
        {fonts.thirdPartyHosts.length > 0 && (
          <div className="flex items-start gap-2 rounded-control bg-danger-bg px-3 py-2.5 text-xs text-danger">
            <ShieldAlert size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">GDPR exposure — third-party font hosting</p>
              <p className="mt-1 text-danger/90">
                Loading fonts from a third-party host transmits the visitor&apos;s IP address to that host without consent. German courts have
                ruled on exactly this pattern for Google Fonts. This is not a performance footnote — it is a legal exposure.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fonts.thirdPartyHosts.map((h) => (
                  <Badge key={h} tone="danger">
                    {h}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {fonts.faces.length === 0 ? (
          <Empty>No @font-face declarations found on this page.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead className="bg-subtle text-xs text-secondary">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left font-medium">Family</th>
                  <th className="px-4 py-2.5 text-left font-medium">Source</th>
                  <th className="px-4 py-2.5 text-left font-medium">font-display</th>
                  <th className="px-4 py-2.5 text-left font-medium">Origin</th>
                  <th className="px-4 py-2.5 text-left font-medium">Preload</th>
                </tr>
              </thead>
              <tbody>
                {fonts.faces.map((f, i) => (
                  <tr key={i} className="min-h-11 border-b border-border last:border-0 hover:bg-subtle">
                    <td className="px-4 py-2.5">{f.family ?? <span className="text-faint">—</span>}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-secondary">{f.source ?? <span className="text-faint">—</span>}</td>
                    <td className="px-4 py-2.5">{f.display ?? <span className="text-faint">— (default: auto)</span>}</td>
                    <td className="px-4 py-2.5 text-secondary">
                      {f.origin === "third-party" ? <Badge tone="warn">{f.host ?? "third-party"}</Badge> : <span className="text-faint">same-origin</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {f.preloadMissingCrossorigin ? (
                        <Badge tone="warn">preloaded without crossorigin — guaranteed double download</Badge>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
