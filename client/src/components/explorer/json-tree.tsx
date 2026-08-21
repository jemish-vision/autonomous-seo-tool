import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

function valueLabel(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

function valueTone(v: unknown): string {
  if (v === null) return "text-faint";
  if (typeof v === "string") return "text-ok";
  if (typeof v === "number") return "text-data-blue";
  if (typeof v === "boolean") return "text-data-violet";
  return "text-foreground";
}

/** Recursive collapsible key tree for parsed JSON-LD — readable structure instead of a raw wall. */
function TreeNode({ keyLabel, value, depth }: { keyLabel: string | null; value: unknown; depth: number }) {
  const isContainer = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 1);

  if (!isContainer) {
    return (
      <div className="flex gap-1.5 py-0.5 font-mono text-xs" style={{ paddingLeft: depth * 14 }}>
        {keyLabel !== null && <span className="text-secondary">{keyLabel}:</span>}
        <span className={valueTone(value)}>{valueLabel(value)}</span>
      </div>
    );
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const isEmpty = entries.length === 0;
  const summary = Array.isArray(value) ? `Array(${entries.length})` : `Object{${entries.length}}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isEmpty}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-control py-0.5 text-left font-mono text-xs outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary disabled:hover:bg-transparent"
        style={{ paddingLeft: depth * 14 }}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={cn("shrink-0 text-faint transition-transform duration-150 ease-out", open && "rotate-90", isEmpty && "opacity-0")}
          aria-hidden="true"
        />
        {keyLabel !== null && <span className="text-secondary">{keyLabel}:</span>}
        <span className="text-faint">{summary}</span>
      </button>
      {open && !isEmpty && (
        <div>
          {entries.map(([k, v]) => (
            <TreeNode key={k} keyLabel={k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="max-h-72 overflow-auto rounded-control border border-border bg-subtle p-2">
      <TreeNode keyLabel={null} value={data} depth={0} />
    </div>
  );
}
