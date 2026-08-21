import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  label: string;
  children: ReactNode;
  className?: string;
}

/** Section eyebrow — matches the "Log tail" label style already shipped in the progress panel. */
export function FormSection({ label, children, className }: Props) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{label}</p>
      {children}
    </div>
  );
}
