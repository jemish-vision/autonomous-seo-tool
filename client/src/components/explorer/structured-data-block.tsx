import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { JsonTree } from "./json-tree";
import type { StructuredDataRecord } from "@/lib/types";

function typeBadge(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const t = (parsed as Record<string, unknown>)["@type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string").join(", ") || null;
  return null;
}

export function StructuredDataBlock({ sd }: { sd: StructuredDataRecord }) {
  // Parse errors have nothing to build a tree from — raw is the only signal, so show it by default.
  const [showRaw, setShowRaw] = useState(Boolean(sd.parseError));
  const type = typeBadge(sd.parsed);

  return (
    <div className="rounded-control border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-subtle px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-secondary">{sd.type}</span>
          {type && <Badge tone="neutral">@type: {type}</Badge>}
        </div>
        {sd.parseError ? <Badge tone="danger">parse error</Badge> : <Badge tone="ok">parsed OK</Badge>}
      </div>

      <div className="p-3">
        {sd.parseError && <p className="mb-3 rounded-control bg-danger-bg px-3 py-2 text-xs text-danger">{sd.parseError}</p>}

        {sd.parsed !== null && !sd.parseError && <JsonTree data={sd.parsed} />}

        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="mt-2 text-xs text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-control"
        >
          {showRaw ? "Hide raw JSON-LD" : "Show raw JSON-LD"}
        </button>
        {showRaw && (
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-control bg-subtle p-3 font-mono text-xs text-secondary">
            {sd.raw}
          </pre>
        )}
      </div>
    </div>
  );
}
