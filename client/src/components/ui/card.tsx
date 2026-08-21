import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface Props extends HTMLAttributes<HTMLDivElement> {
  hoverLift?: boolean;
}

export function Card({ className, hoverLift, ...rest }: Props) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-card p-5 shadow-card",
        hoverLift && "transition-[transform,box-shadow] duration-[180ms] ease-out hover:-translate-y-px hover:shadow-popover",
        className,
      )}
      {...rest}
    />
  );
}
