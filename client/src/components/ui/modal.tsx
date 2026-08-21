import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "full";

const SIZE_MAP: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  "2xl": "max-w-6xl",
  full: "max-w-[95vw] w-[95vw] h-[90vh]",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
  bodyClassName?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  badge,
  headerRight,
  children,
  footer,
  size = "xl",
  className,
  bodyClassName = "p-5",
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const panel = modalRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables?.[0]?.focus();

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 md:p-8">
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-sm transition-opacity animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex max-h-[94vh] w-full flex-col rounded-xl sm:rounded-2xl md:rounded-[22px] border border-border/80 bg-card shadow-2xl overflow-hidden",
          SIZE_MAP[size],
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 sm:px-6 py-3.5 bg-card shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-foreground truncate">{title}</h2>
                {badge}
              </div>
              {description && <p className="mt-0.5 text-xs text-secondary">{description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="flex h-8 w-8 items-center justify-center rounded-control text-secondary hover:bg-subtle hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className={cn("flex-1 overflow-y-auto min-h-0", bodyClassName)}>{children}</div>

        {footer && <div className="border-t border-border px-4 sm:px-6 py-3 bg-subtle/40 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
