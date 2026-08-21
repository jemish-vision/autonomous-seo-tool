import { useState } from "react";
import { ExternalLink, Plug, Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { SourceConfig, SourceStatus, SourceCapabilities } from "@/lib/types-sources";

const KIND_ICONS: Record<string, string> = {
  wordpress: "🔷",
  shopify: "🟢",
  cloudarcade: "🎮",
};

const KIND_LABELS: Record<string, string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  cloudarcade: "ATM Games",
};

interface Meta {
  status: SourceStatus | null;
  capabilities: SourceCapabilities | null;
}

interface Props {
  sources: SourceConfig[];
  meta: Record<string, Meta>;
  onConnect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
}

/** Connected sources as a compact table (Active · Source · Platform · Site · Status · Actions). */
export function SourceTable({ sources, meta, onConnect, onDelete, onActivate }: Props) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wider text-faint">
              <th className="px-4 py-2.5 font-medium">Active</th>
              <th className="px-4 py-2.5 font-medium">Source</th>
              <th className="px-4 py-2.5 font-medium">Platform</th>
              <th className="px-4 py-2.5 font-medium">Site</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                status={meta[source.id]?.status ?? null}
                onConnect={onConnect}
                onDelete={onDelete}
                onActivate={onActivate}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SourceRow({
  source,
  status,
  onConnect,
  onDelete,
  onActivate,
}: {
  source: SourceConfig;
  status: SourceStatus | null;
  onConnect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
}) {
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const stateColor = status?.state === "connected" ? "ok" : status?.state === "error" ? "danger" : "neutral";
  const stateLabel =
    status?.state === "connected"
      ? "Connected"
      : status?.state === "error"
        ? "Error"
        : status?.state === "unchecked"
          ? "Not checked"
          : status?.state === "disconnected"
            ? "Disconnected"
            : "Checking…";

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await onConnect(source.id);
    } finally {
      setConnecting(false);
    }
  };

  const performDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(source.id);
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleActivate = async () => {
    if (source.active || activating) return;
    setActivating(true);
    try {
      await onActivate(source.id);
    } finally {
      setActivating(false);
    }
  };

  const host = source.siteUrl.replace(/^https?:\/\//, "");

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-subtle/40">
      {/* Active */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="radio"
            name="active-source"
            checked={Boolean(source.active)}
            onChange={handleActivate}
            disabled={activating}
            aria-label={`Set ${source.name} as the active connection`}
            className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
          {source.active && <Badge tone="ok">Active</Badge>}
        </div>
      </td>

      {/* Source */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg leading-none" aria-hidden="true">
            {KIND_ICONS[source.kind] ?? "🔌"}
          </span>
          <span className="font-medium text-foreground">{source.name}</span>
        </div>
        {status?.state === "error" && status.error && (
          <p className="mt-1 max-w-md truncate text-[11px] text-danger" title={status.error}>
            {status.error}
          </p>
        )}
      </td>

      {/* Platform */}
      <td className="px-4 py-3 text-secondary">{KIND_LABELS[source.kind] ?? source.kind}</td>

      {/* Site */}
      <td className="px-4 py-3">
        <a
          href={source.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-[220px] items-center gap-1 truncate font-medium text-foreground underline-offset-2 hover:underline"
          title={host}
        >
          <span className="truncate">{host}</span>
          <ExternalLink size={11} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
        </a>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <Badge tone={stateColor}>{stateLabel}</Badge>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-control border border-border bg-subtle px-2.5 py-1.5 text-xs font-medium text-secondary transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-elevated hover:text-foreground",
              connecting && "opacity-50 cursor-not-allowed",
            )}
          >
            {connecting ? (
              <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plug size={12} aria-hidden="true" />
            )}
            {connecting ? "Checking…" : "Test"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting}
            aria-label={`Delete ${source.name}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-control border border-border bg-subtle px-2.5 py-1.5 text-xs font-medium text-danger transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-danger-bg",
              deleting && "opacity-50 cursor-not-allowed",
            )}
          >
            <Trash2 size={12} aria-hidden="true" />
            Delete
          </button>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={performDelete}
          title="Delete source"
          message={
            <>
              Delete source <span className="font-medium text-foreground">{source.name}</span>? This
              cannot be undone.
            </>
          }
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
        />
      </td>
    </tr>
  );
}
