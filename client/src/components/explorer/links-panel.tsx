import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { CopyButton } from "@/components/ui/copy-button";
import type { LinkRecord } from "@/lib/types";

export function LinksPanel({ links }: { links: LinkRecord[] }) {
  const [filter, setFilter] = useState<"all" | "internal" | "external">("all");
  const internalCount = links.filter((l) => l.type === "internal").length;
  const externalCount = links.length - internalCount;
  const filtered = useMemo(() => (filter === "all" ? links : links.filter((l) => l.type === filter)), [links, filter]);

  return (
    <Card id="links">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-faint">Links</h2>
        <div className="flex gap-1.5">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All ({links.length})
          </Chip>
          <Chip active={filter === "internal"} onClick={() => setFilter("internal")}>
            Internal ({internalCount})
          </Chip>
          <Chip active={filter === "external"} onClick={() => setFilter("external")}>
            External ({externalCount})
          </Chip>
        </div>
      </div>
      {links.length === 0 ? (
        <p className="text-sm text-faint">No links found on this page.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-faint">No {filter} links.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="bg-subtle text-xs text-secondary">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left font-medium">Anchor</th>
                <th className="px-4 py-2.5 text-left font-medium">Target (as authored)</th>
                <th className="px-4 py-2.5 text-left font-medium">Target normalized</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-left font-medium">Rel</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((link, i) => (
                <tr key={i} className="min-h-11 border-b border-border last:border-0 hover:bg-subtle">
                  <td className="max-w-[16ch] truncate px-4 py-2.5">{link.anchor || <span className="text-faint">(empty)</span>}</td>
                  <td className="max-w-xs px-4 py-2.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate font-mono text-xs" title={link.target}>{link.target}</span>
                      <CopyButton text={link.target} label="Copy target link" />
                    </div>
                  </td>
                  <td className="max-w-xs px-4 py-2.5 text-secondary">
                    {link.targetNormalized ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-mono text-xs" title={link.targetNormalized}>{link.targetNormalized}</span>
                        <CopyButton text={link.targetNormalized} label="Copy normalized link" />
                      </div>
                    ) : (
                      <span className="text-faint">null</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={link.type === "internal" ? "neutral" : "warn"}>{link.type}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {link.nofollow && <Badge tone="danger">nofollow</Badge>}
                      {link.sponsored && <Badge tone="warn">sponsored</Badge>}
                      {link.ugc && <Badge tone="warn">ugc</Badge>}
                      {!link.nofollow && !link.sponsored && !link.ugc && (
                        <span className="text-faint">{link.rel ?? "—"}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
