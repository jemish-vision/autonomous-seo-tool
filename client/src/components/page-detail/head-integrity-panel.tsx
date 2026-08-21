import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExtendedCrawledPage } from "./types";
import { SectionCard, Empty, NotCaptured } from "./section-helpers";

function strandedLabel(s: { signal?: string; field?: string; name?: string }): string {
  return s.signal ?? s.field ?? s.name ?? "unnamed signal";
}

export function HeadIntegrityPanel({ page }: { page: ExtendedCrawledPage }) {
  const { headBoundary, charset, baseHref } = page;

  if (headBoundary === undefined && charset === undefined && baseHref === undefined) {
    return (
      <SectionCard id="head-integrity" title="Head integrity">
        <NotCaptured>Not captured in this run (re-crawl to capture head-boundary, charset, and base-href signals).</NotCaptured>
      </SectionCard>
    );
  }

  return (
    <SectionCard id="head-integrity" title="Head integrity">
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Head boundary</h3>
          {headBoundary === undefined ? (
            <NotCaptured>Not captured in this run.</NotCaptured>
          ) : (
            <>
              {headBoundary.closedBy !== null && (
                <div className="mb-3 flex items-start gap-2 rounded-control bg-danger-bg px-3 py-2.5 text-xs text-danger">
                  <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <p>
                    <span className="font-medium">&lt;{headBoundary.closedBy}&gt;</span> closed <code>&lt;head&gt;</code> early at byte offset{" "}
                    <span className="tabular-nums">{headBoundary.closedAtOffset ?? "unknown"}</span> — Google stops reading metadata from this
                    point forward. Anything declared after this offset was not seen.
                  </p>
                </div>
              )}
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-faint">Head element count</dt>
                  <dd className="tabular-nums text-foreground">{headBoundary.elementCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Closed early by</dt>
                  <dd className="text-foreground">
                    {headBoundary.closedBy === null ? <Badge tone="ok">no — head closed cleanly</Badge> : <Badge tone="danger">&lt;{headBoundary.closedBy}&gt;</Badge>}
                  </dd>
                </div>
              </dl>
              <div className="mt-3">
                <h4 className="mb-1.5 text-xs text-faint">Stranded signals (per-signal, not one verdict)</h4>
                {headBoundary.stranded.length === 0 ? (
                  <Empty>No signals were stranded outside the head boundary.</Empty>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {headBoundary.stranded.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 rounded-control border border-border bg-subtle px-3 py-2">
                        <span className="truncate text-foreground">{strandedLabel(s)}</span>
                        <Badge tone={s.honoured ? "ok" : "danger"} className="shrink-0">
                          {s.honoured ? "honoured by Google" : "NOT honoured by Google"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Charset</h3>
          {charset === undefined ? (
            <NotCaptured>Not captured in this run.</NotCaptured>
          ) : (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-faint">Declared value</dt>
                <dd className="text-foreground">{charset.value ?? <span className="text-faint">— (none)</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Source</dt>
                <dd className="text-foreground">{charset.source ?? <span className="text-faint">—</span>}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-faint">Effective</dt>
                <dd>
                  {charset.effective ? (
                    <Badge tone="ok">effective</Badge>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="danger">not effective</Badge>
                      <span className="text-xs text-secondary">
                        declared at byte offset {charset.metaOffset ?? "unknown"} — past the 1024-byte limit browsers scan, so it silently does not
                        work.
                      </span>
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Base href</h3>
          {baseHref === undefined ? (
            <NotCaptured>Not captured in this run.</NotCaptured>
          ) : baseHref.count === 0 ? (
            <Empty>No &lt;base&gt; element found.</Empty>
          ) : (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-faint">Effective href</dt>
                <dd className="truncate text-foreground">{baseHref.href ?? <span className="text-faint">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Declared count</dt>
                <dd className="flex items-center gap-2">
                  <span className="tabular-nums text-foreground">{baseHref.count}</span>
                  {baseHref.count > 1 && <Badge tone="warn">all but the first are ignored</Badge>}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
