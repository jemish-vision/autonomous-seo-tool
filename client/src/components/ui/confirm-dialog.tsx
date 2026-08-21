import type { ReactNode } from "react";
import { Modal } from "./modal";
import { cn } from "@/lib/cn";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" = destructive (solid red confirm); "primary" = neutral action. */
  tone?: "danger" | "primary";
  /** When true, buttons show a busy state and are disabled; backdrop/Esc close is suppressed. */
  busy?: boolean;
}

/**
 * In-app confirmation dialog — the accessible replacement for the blocking native `window.confirm()`.
 * Built on <Modal> (portal + focus-trap + Esc + backdrop-close), so it never freezes the page the way
 * a native dialog does. Use for destructive/irreversible actions (delete, disconnect, etc.).
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      size="sm"
      bodyClassName="px-5 py-4"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn(
              "rounded-control border border-border bg-subtle px-3 py-1.5 text-xs font-medium text-secondary transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-elevated hover:text-foreground",
              busy && "opacity-50 cursor-not-allowed",
            )}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "rounded-control px-3 py-1.5 text-xs font-medium text-white transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              tone === "danger"
                ? "bg-danger hover:bg-danger/90 focus-visible:ring-danger"
                : "bg-primary hover:bg-primary/90 focus-visible:ring-primary",
              busy && "opacity-60 cursor-not-allowed",
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm text-secondary">{message}</p>
    </Modal>
  );
}
