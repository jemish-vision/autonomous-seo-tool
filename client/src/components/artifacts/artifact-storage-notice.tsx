import { CloudOff } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  reason?: string;
  className?: string;
}

/** MVP acceptance criterion #11: the one named, reusable "artifact storage not configured" state.
 *  Drop wherever artifacts/screenshots/page-replay appear; renders nothing when configured (see
 *  callers) so it lights up automatically off the SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL env
 *  pair, no code change required. */
export function ArtifactStorageNotice({ reason, className }: Props) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-control border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn",
        className,
      )}
    >
      <CloudOff size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-medium">Artifact storage not configured.</strong> Screenshots and page
        captures are served from local disk only — the durable cloud copy is unavailable
        {reason ? ` (${reason})` : ""}. Set{" "}
        <code className="rounded bg-black/10 px-1 py-0.5">SUPABASE_URL</code> and{" "}
        <code className="rounded bg-black/10 px-1 py-0.5">SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
        <code className="rounded bg-black/10 px-1 py-0.5">poc/seo-dashboard/.env</code> to enable it.
      </span>
    </div>
  );
}
