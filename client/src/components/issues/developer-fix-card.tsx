import { useState } from "react";
import { Code, Copy, Check, Terminal, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FixPlanItem } from "@/lib/types";

export function DeveloperFixCard({ item }: { item: FixPlanItem }) {
  const [copied, setCopied] = useState(false);

  const snippetText = Array.isArray(item.change) ? item.change.join("\n") : item.change;

  function handleCopy() {
    navigator.clipboard.writeText(snippetText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-card border border-border bg-subtle/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-faint">
            Developer Fix Plan
          </span>
        </div>
        <Badge tone="neutral" className="normal-case text-[11px] font-mono">
          <FileCode size={12} className="mr-1 inline-block" />
          {item.where}
        </Badge>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{item.action}</p>
        {item.note && (
          <p className="text-xs text-secondary italic">{item.note}</p>
        )}
      </div>

      <div className="relative rounded-control border border-border bg-subtle p-3 font-mono text-xs text-foreground overflow-x-auto">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/50 text-[11px] text-faint">
          <span className="flex items-center gap-1 font-sans font-medium">
            <Code size={13} /> Proposed Code Snippet
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-6 px-2 text-[11px] gap-1"
          >
            {copied ? (
              <>
                <Check size={12} className="text-ok" /> Copied!
              </>
            ) : (
              <>
                <Copy size={12} /> Copy Snippet
              </>
            )}
          </Button>
        </div>
        <pre className="whitespace-pre-wrap break-all text-xs text-foreground">
          {snippetText}
        </pre>
      </div>
    </div>
  );
}
