import { Badge } from "@/components/ui/badge";
import type { ExtendedCrawledPage } from "./types";
import { SectionCard, Empty, NotCaptured } from "./section-helpers";

// Static map (not a template literal) so Tailwind's class scanner can find every class used.
const LEVEL_INDENT: Record<number, string> = {
  1: "ml-0",
  2: "ml-4",
  3: "ml-8",
  4: "ml-12",
  5: "ml-16",
  6: "ml-20",
};

export function DocumentStructurePanel({ page }: { page: ExtendedCrawledPage }) {
  const structure = page.structure;

  if (structure === undefined) {
    return (
      <SectionCard id="document-structure" title="Document structure">
        <NotCaptured>Not captured in this run (re-crawl to capture the heading outline and content structure).</NotCaptured>
      </SectionCard>
    );
  }

  const listsTotal = structure.lists.ordered + structure.lists.unordered + structure.lists.definition;

  return (
    <SectionCard id="document-structure" title="Document structure" count={`${structure.headings.length} heading(s)`}>
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Heading outline (document order)</h3>
          {structure.headings.length === 0 ? (
            <Empty>No headings found on this page.</Empty>
          ) : (
            <ol className="space-y-1 text-sm">
              {structure.headings.map((h, i) => (
                <li key={i} className={`flex items-baseline gap-2 ${LEVEL_INDENT[h.level] ?? "ml-0"}`}>
                  <Badge tone="neutral">H{h.level}</Badge>
                  <span className="truncate text-foreground">{h.text}</span>
                  {!h.inMain && (
                    <Badge tone="warn" className="shrink-0">
                      outside main
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Content blocks</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-faint">Paragraphs</dt>
              <dd className="tabular-nums text-foreground">{structure.paragraphs}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Lists</dt>
              <dd className="tabular-nums text-foreground">
                {listsTotal}
                <span className="ml-1 text-xs text-faint">
                  ({structure.lists.ordered} ol · {structure.lists.unordered} ul · {structure.lists.definition} dl)
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Code blocks</dt>
              <dd className="tabular-nums text-foreground">{structure.codeBlocks}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Blockquotes</dt>
              <dd className="tabular-nums text-foreground">{structure.blockquotes}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Tables</h3>
          {structure.tables.total === 0 ? (
            <Empty>No tables found on this page.</Empty>
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-faint">Total</dt>
                <dd className="tabular-nums text-foreground">{structure.tables.total}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">With &lt;th&gt; (data table)</dt>
                <dd className="tabular-nums text-foreground">{structure.tables.withTh}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">With &lt;caption&gt;</dt>
                <dd className="tabular-nums text-foreground">{structure.tables.withCaption}</dd>
              </div>
            </dl>
          )}
          <p className="mt-1.5 text-xs text-faint">Tables without a &lt;th&gt; are typically layout tables, not real tabular data.</p>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Landmarks</h3>
          {structure.landmarks.length === 0 ? (
            <Empty>No ARIA/HTML5 landmarks found.</Empty>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {structure.landmarks.map((l) => (
                <Badge key={l} tone="neutral">
                  {l}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
