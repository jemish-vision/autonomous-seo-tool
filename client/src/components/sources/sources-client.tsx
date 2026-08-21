import { useState, useEffect, useCallback, useRef } from "react";
import { Plug, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { SourceTable } from "./source-table";
import { AddSourceForm } from "./add-source-form";
import { useSources, useConnectSource, useDeleteSource } from "@/api/sources";
import type { SourceConfig, SourceStatus, SourceCapabilities } from "@/lib/types-sources";

interface Meta {
  status: SourceStatus | null;
  capabilities: SourceCapabilities | null;
}

export function SourcesClient({ initialSources }: { initialSources: SourceConfig[] }) {
  // Live list from the API (React Query) — seeded with what the route already fetched so there is no
  // flash. Mutations invalidate ["sources"], which re-drives this list.
  const { data: sources = initialSources } = useSources();

  const connectMut = useConnectSource();
  const deleteMut = useDeleteSource();

  // Per-source live status/capabilities (from a connect/health-check). Keyed by source id.
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [modalOpen, setModalOpen] = useState(false);

  /** Connect (health-check) a source and record its status in place. */
  const handleConnect = useCallback(
    async (id: string) => {
      const result = await connectMut.mutateAsync(id);
      setMeta((prev) => ({
        ...prev,
        [id]: {
          status:
            result.status ??
            (result.ok
              ? { sourceId: id, state: "connected", lastCheckedAt: new Date().toISOString() }
              : { sourceId: id, state: "error", lastCheckedAt: new Date().toISOString(), error: result.error }),
          capabilities: result.capabilities ?? null,
        },
      }));
    },
    [connectMut],
  );

  /** Delete a source. */
  const handleDelete = useCallback(
    async (id: string) => {
      await deleteMut.mutateAsync(id);
      setMeta((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [deleteMut],
  );

  /** Auto-connect each source once on first appearance to fetch live status (matches old app). */
  const probed = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of sources) {
      if (probed.current.has(s.id)) continue;
      probed.current.add(s.id);
      handleConnect(s.id).catch(() => {});
    }
  }, [sources, handleConnect]);

  return (
    <div className="space-y-4">
      {/* Toolbar: count + Connect button */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-secondary">
          {sources.length === 0
            ? "No sources connected"
            : `${sources.length} ${sources.length === 1 ? "source" : "sources"} connected`}
        </p>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-control bg-primary px-3.5 py-2 text-sm font-medium text-primary-contrast transition-colors hover:bg-primary/90",
            "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          )}
        >
          <Plus size={15} strokeWidth={2} aria-hidden="true" />
          Connect source
        </button>
      </div>

      {/* List (table) or empty state */}
      {sources.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong bg-subtle px-6 py-12 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-control border border-border bg-elevated">
            <Plug size={20} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-foreground">No sources connected yet</p>
          <p className="max-w-md text-xs text-secondary">
            Connect a WordPress or Shopify site to manage SEO settings directly from the dashboard.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-control border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-elevated"
          >
            <Plus size={13} strokeWidth={2} aria-hidden="true" /> Connect a source
          </button>
        </div>
      ) : (
        <SourceTable
          sources={sources}
          meta={meta}
          onConnect={handleConnect}
          onDelete={handleDelete}
        />
      )}

      <AddSourceForm open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
