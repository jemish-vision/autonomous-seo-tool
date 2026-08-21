import { Search } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { eventKindMeta } from "@/lib/events-view";

export type StatusFilter = "2xx" | "3xx" | "4xx" | "5xx" | null;

interface Props {
  kindCounts: Map<string, number>;
  activeKinds: Set<string>;
  onToggleKind: (kind: string) => void;
  onClearKinds: () => void;
  status: StatusFilter;
  statusCounts: Record<"2xx" | "3xx" | "4xx" | "5xx", number>;
  onStatus: (s: StatusFilter) => void;
  search: string;
  onSearch: (v: string) => void;
  total: number;
  visible: number;
}

const STATUS_VALUES: Exclude<StatusFilter, null>[] = ["2xx", "3xx", "4xx", "5xx"];

export function ActivityFilters({ kindCounts, activeKinds, onToggleKind, onClearKinds, status, statusCounts, onStatus, search, onSearch, total, visible }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 w-full max-w-sm items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
          <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Filter by URL or message..."
            aria-label="Filter activity by URL or message"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
          />
        </div>
        <p className="text-xs text-secondary">
          {visible.toLocaleString()} of {total.toLocaleString()} event{total === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">Status</span>
        <Chip active={status === null} onClick={() => onStatus(null)}>
          All
        </Chip>
        {STATUS_VALUES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => onStatus(status === s ? null : s)}>
            {s} ({statusCounts[s]})
          </Chip>
        ))}
      </div>

      {kindCounts.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-faint">Kind</span>
          <Chip active={activeKinds.size === 0} onClick={onClearKinds}>
            All
          </Chip>
          {[...kindCounts.entries()].map(([kind, count]) => (
            <Chip key={kind} active={activeKinds.has(kind)} onClick={() => onToggleKind(kind)}>
              {eventKindMeta(kind).label} ({count})
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
