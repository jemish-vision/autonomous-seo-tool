import { useState } from "react";
import { ExternalLink, Plug, Unplug, Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SourceConfig, SourceStatus, SourceCapabilities } from "@/lib/types-sources";

const KIND_ICONS: Record<string, string> = {
  wordpress: "🔷",
  shopify: "🟢",
};

const KIND_LABELS: Record<string, string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
};

interface Props {
  source: SourceConfig;
  status: SourceStatus | null;
  capabilities: SourceCapabilities | null;
  onConnect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function SourceCard({ source, status, capabilities, onConnect, onDelete }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await onConnect(source.id);
    } finally {
      setConnecting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete source "${source.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete(source.id);
    } finally {
      setDeleting(false);
    }
  };

  const stateColor = status?.state === "connected" ? "ok" : status?.state === "error" ? "danger" : "neutral";
  const stateLabel = status?.state === "connected" ? "Connected" : status?.state === "error" ? "Error" : status?.state === "unchecked" ? "Not checked" : "Disconnected";

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">
            {KIND_ICONS[source.kind] ?? "🔌"}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{source.name}</h3>
            <p className="text-xs text-secondary">{KIND_LABELS[source.kind] ?? source.kind}</p>
          </div>
        </div>
        <Badge tone={stateColor}>{stateLabel}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-faint">Site</span>
          <p className="mt-0.5 truncate">
            <a
              href={source.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
            >
              {source.siteUrl.replace(/^https?:\/\//, "")}
              <ExternalLink size={11} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
            </a>
          </p>
        </div>
        {capabilities?.seoProvider && (
          <div>
            <span className="text-faint">SEO Provider</span>
            <p className="mt-0.5 font-medium text-foreground">{capabilities.seoProvider}</p>
          </div>
        )}
        {capabilities?.wordpressVersion && (
          <div>
            <span className="text-faint">WordPress</span>
            <p className="mt-0.5 font-medium text-foreground">{capabilities.wordpressVersion}</p>
          </div>
        )}
        {capabilities?.woocommerce !== undefined && (
          <div>
            <span className="text-faint">WooCommerce</span>
            <p className="mt-0.5 font-medium text-foreground">{capabilities.woocommerce ? "Active" : "Not detected"}</p>
          </div>
        )}
        {status?.error && (
          <div className="col-span-2">
            <span className="text-faint">Last error</span>
            <p className="mt-0.5 text-danger text-xs">{status.error}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors",
            "outline-none focus-visible:ring-2 focus-visible:ring-primary",
            "border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground",
            connecting && "opacity-50 cursor-not-allowed",
          )}
        >
          {connecting ? (
            <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <Plug size={12} aria-hidden="true" />
          )}
          {connecting ? "Checking…" : "Test connection"}
        </button>

        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors",
            "outline-none focus-visible:ring-2 focus-visible:ring-primary",
            "border-border bg-subtle text-danger hover:bg-danger-bg",
            deleting && "opacity-50 cursor-not-allowed",
          )}
        >
          <Trash2 size={12} aria-hidden="true" />
          Delete
        </button>
      </div>
    </Card>
  );
}
