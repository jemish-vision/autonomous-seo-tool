import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  htmlFor: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

/** Label + control + error-or-hint slot. Error replaces hint (never both) so the row height stays put. */
export function FormField({ htmlFor, label, hint, error, children, className }: Props) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-secondary">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-faint">{hint}</p>
      ) : null}
    </div>
  );
}
