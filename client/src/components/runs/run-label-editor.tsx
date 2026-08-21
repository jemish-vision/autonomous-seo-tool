import { useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { useUpdateRunMeta } from "@/api/run-meta";
import { cn } from "@/lib/cn";

/**
 * Minimal inline editor for a run's dashboard label (PATCH /api/crawls/:runId/meta). Collapsed it
 * shows the current label (or a quiet "Add label" affordance) with a pencil; expanded it swaps in a
 * text input with save/cancel. On save the useUpdateRunMeta mutation invalidates ["runs"] so the
 * hub re-reads the fresh label. Notes/tags are supported by the same endpoint but not surfaced here.
 */
export function RunLabelEditor({ runId, label }: { runId: string; label: string | null | undefined }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label ?? "");
  const update = useUpdateRunMeta(runId);

  function open() {
    setValue(label ?? "");
    setEditing(true);
  }

  function save() {
    update.mutate(
      { label: value.trim() || null },
      { onSuccess: () => setEditing(false) },
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open();
        }}
        className="group/label mt-0.5 inline-flex items-center gap-1 text-[11px] font-normal text-faint outline-none transition-colors duration-150 hover:text-secondary focus-visible:ring-2 focus-visible:ring-primary"
        title="Edit run label"
      >
        {label ? (
          <span className="truncate rounded-pill bg-subtle px-1.5 py-px text-secondary">{label}</span>
        ) : (
          <span className="text-faint">Add label</span>
        )}
        <Pencil size={11} strokeWidth={1.75} className="shrink-0 opacity-0 transition-opacity duration-150 group-hover/label:opacity-100" aria-hidden="true" />
      </button>
    );
  }

  return (
    <span className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        autoFocus
        value={value}
        disabled={update.isPending}
        placeholder="Run label"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className={cn(
          "w-40 rounded-control border border-border bg-canvas px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-faint focus:ring-2 focus:ring-primary disabled:opacity-50",
        )}
      />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          save();
        }}
        disabled={update.isPending}
        className="flex h-6 w-6 items-center justify-center rounded-control text-ok outline-none transition-colors duration-150 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        title="Save label"
        aria-label="Save label"
      >
        {update.isPending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Check size={12} strokeWidth={2} aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setEditing(false);
        }}
        disabled={update.isPending}
        className="flex h-6 w-6 items-center justify-center rounded-control text-faint outline-none transition-colors duration-150 hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        title="Cancel"
        aria-label="Cancel"
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {update.isError && <span className="text-[10px] text-danger">{(update.error as Error).message}</span>}
    </span>
  );
}
