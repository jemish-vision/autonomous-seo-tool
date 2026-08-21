import { Link } from "react-router-dom";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { formatEvidenceValue } from "@/lib/data-issues";
import type { PageChange } from "@/lib/data-compare";

const FIELD_LABELS: Record<string, string> = {
  statusCode: "Status",
  title: "Title",
  metaDescription: "Meta description",
  canonical: "Canonical",
  "robots.noindex": "Noindex",
  h1: "H1",
  "content.contentHash": "Content",
  "content.wordCount": "Word count",
  "links.length": "Links",
  "images.length": "Images",
  "redirectChain.length": "Redirect hops",
  renderedWith: "Rendered with",
};

/** Changed pages between the two selected runs — every row links to its page detail IN THE HEAD
 * run, since that's the current state a reviewer would act on. */
export function ChangedPagesTable({ changed, headRunId }: { changed: PageChange[]; headRunId: string }) {
  return (
    <TableContainer>
      <TableHead>
        <Th>Page</Th>
        <Th>Fields changed</Th>
      </TableHead>
      <tbody>
        {changed.map((change) => (
          <Tr key={change.pageId}>
            <Td className="max-w-xs align-top">
              <Link
                to={`/pages/${change.pageId}?run=${encodeURIComponent(headRunId)}`}
                className="block truncate font-medium text-primary underline underline-offset-2"
              >
                {change.url}
              </Link>
            </Td>
            <Td className="align-top">
              <ul className="space-y-1">
                {change.changes.map((fc) => (
                  <li key={fc.field} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-pill bg-subtle px-1.5 py-0.5 font-medium text-secondary">{FIELD_LABELS[fc.field] ?? fc.field}</span>
                    <span className="text-faint">{formatEvidenceValue(fc.before)}</span>
                    <span aria-hidden="true" className="text-faint">
                      →
                    </span>
                    <span className="text-foreground">{formatEvidenceValue(fc.after)}</span>
                  </li>
                ))}
              </ul>
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableContainer>
  );
}
