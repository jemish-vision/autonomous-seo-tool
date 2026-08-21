import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  text: string;
  label?: string;
  className?: string;
  size?: "xs" | "sm" | "md";
  showText?: boolean;
}

export function CopyButton({ text, label = "Copy URL", className, size = "xs", showText = false }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Best-effort
    }
  }

  const iconSize = size === "xs" ? 12 : size === "sm" ? 14 : 16;

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied to clipboard!" : label}
      aria-label={copied ? "Copied to clipboard!" : label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded p-1 text-faint hover:bg-subtle hover:text-foreground transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
        copied && "text-ok hover:text-ok bg-ok/10",
        className,
      )}
    >
      {copied ? (
        <Check size={iconSize} strokeWidth={2} className="text-ok" aria-hidden="true" />
      ) : (
        <Copy size={iconSize} strokeWidth={1.75} aria-hidden="true" />
      )}
      {showText && (
        <span className="ml-1 text-xs font-medium">{copied ? "Copied" : "Copy"}</span>
      )}
    </button>
  );
}
