import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "ok" | "danger" | "warn" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  danger: "bg-danger-bg text-danger",
  warn: "bg-warn-bg text-warn",
  neutral: "bg-subtle text-secondary",
};

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, children, ...rest }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-control px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
