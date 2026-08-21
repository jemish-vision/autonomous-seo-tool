import { Info, FileQuestion } from "lucide-react";
import { Card } from "@/components/ui/card";

interface LlmsTxt {
  available: boolean;
  /** The crawler fetched the file and it counts as a real llms.txt (not an HTML error page). */
  present?: boolean;
  reason?: string | null;
  content?: string | null;
  url?: string | null;
  statusCode?: number | null;
  bytes?: number | null;
  fetchedAt?: string | null;
}

/** llms.txt is reported for information only — it must never read as though it affects a score
 *  (it doesn't feed the AI-crawler verdicts, the health score, or anything else on this screen). */
export function LlmsPanel({ llmsTxt }: { llmsTxt: LlmsTxt | null | undefined }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">llms.txt</h2>
        <span className="inline-flex items-center gap-1 rounded-pill bg-subtle px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">
          <Info size={11} strokeWidth={2} aria-hidden="true" />
          Informational only — never affects a score
        </span>
      </div>
      {llmsTxt?.available && llmsTxt.url && (
        <p className="mb-2 text-xs text-faint">
          {llmsTxt.url}
          {typeof llmsTxt.statusCode === "number" && ` · HTTP ${llmsTxt.statusCode}`}
          {typeof llmsTxt.bytes === "number" && (
            <>
              {" · "}
              <span className="tabular-nums">{llmsTxt.bytes.toLocaleString()} bytes</span>
            </>
          )}
          {llmsTxt.fetchedAt && ` · fetched ${new Date(llmsTxt.fetchedAt).toLocaleString()}`}
        </p>
      )}
      {llmsTxt?.available && llmsTxt.content ? (
        <pre className="max-h-56 overflow-auto rounded-control border border-border bg-elevated p-3 text-xs text-secondary">{llmsTxt.content}</pre>
      ) : (
        <div className="flex items-start gap-3 rounded-control border border-dashed border-border-strong bg-subtle p-3">
          <FileQuestion size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
          <p className="text-xs text-secondary">{llmsTxt?.reason ?? "Not captured for this run."}</p>
        </div>
      )}
    </Card>
  );
}
