import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const PREVIEW_CHARS = 320;

export function ContentPanel({ text, wordCount, contentHash }: { text: string; wordCount: number; contentHash: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncatable = text.length > PREVIEW_CHARS;

  return (
    <Card id="content">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-faint">Content</h2>
        <span className="text-xs tabular-nums text-faint">{wordCount} words</span>
      </div>
      <dl className="mb-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-faint">Word count</dt>
          <dd className="tabular-nums text-foreground">{wordCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Content hash (sha256)</dt>
          <dd className="truncate font-mono text-xs text-foreground">{contentHash}</dd>
        </div>
      </dl>
      {text.length === 0 ? (
        <p className="text-sm text-faint">No extracted text content.</p>
      ) : (
        <div>
          <p className="whitespace-pre-wrap text-sm text-secondary">{expanded || !truncatable ? text : `${text.slice(0, PREVIEW_CHARS)}…`}</p>
          {truncatable && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Show less" : "Show full text"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
