import { Badge } from "@/components/ui/badge";
import type { ExtendedCrawledPage } from "./types";
import { SectionCard, Empty, NotCaptured } from "./section-helpers";

function eligibilityBadge(eligible: boolean | null) {
  if (eligible === true) return <Badge tone="ok">eligible</Badge>;
  if (eligible === false) return <Badge tone="danger">not eligible</Badge>;
  return <Badge tone="warn">undetermined</Badge>;
}

export function FaviconsPanel({ page }: { page: ExtendedCrawledPage }) {
  const favicons = page.favicons;

  if (favicons === undefined) {
    return (
      <SectionCard id="favicons" title="Favicons">
        <NotCaptured>Not captured in this run (re-crawl to capture favicon declarations).</NotCaptured>
      </SectionCard>
    );
  }

  return (
    <SectionCard id="favicons" title="Favicons" count={`${favicons.candidates.length} candidate(s)`}>
      <div className="space-y-4">
        {favicons.candidates.length === 0 ? (
          <Empty>No favicon declarations or implicit conventions found.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead className="bg-subtle text-xs text-secondary">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left font-medium">Rel</th>
                  <th className="px-4 py-2.5 text-left font-medium">Href</th>
                  <th className="px-4 py-2.5 text-left font-medium">Sizes</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {favicons.candidates.map((c, i) => (
                  <tr key={`${c.href}-${i}`} className="min-h-11 border-b border-border last:border-0 hover:bg-subtle">
                    <td className="px-4 py-2.5">{c.rel}</td>
                    <td className="max-w-xs truncate px-4 py-2.5">{c.href}</td>
                    <td className="px-4 py-2.5 text-secondary">{c.declaredSizes ?? <span className="text-faint">—</span>}</td>
                    <td className="px-4 py-2.5 text-secondary">{c.type ?? <span className="text-faint">—</span>}</td>
                    <td className="px-4 py-2.5">
                      {c.index < 0 ? (
                        <Badge tone="neutral">implicit convention (index {c.index})</Badge>
                      ) : (
                        <Badge tone="neutral">declared (index {c.index})</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-faint">
          Negative index = an implicit browser convention (e.g. <code>/favicon.ico</code>); any explicit declaration outranks it.
        </p>

        <div className="rounded-control border border-border bg-subtle px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs text-faint">Google SERP eligible</span>
            {eligibilityBadge(favicons.googleSerpEligible)}
          </div>
          {favicons.googleSerpEligible === null && (
            <p className="mb-1.5 text-xs text-secondary">Undetermined — not the same as ineligible. Google hasn&apos;t confirmed either way.</p>
          )}
          {favicons.googleSerpBlockers.length > 0 && (
            <ul className="mt-1 space-y-1 text-xs text-secondary">
              {favicons.googleSerpBlockers.map((b) => (
                <li key={b} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden="true" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
