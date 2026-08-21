import { useState } from "react";
import { HelpCircle, Check } from "lucide-react";

/** Copies the real POC-1-REPORT.md path — no fake link, since file:// nav from http pages is blocked anyway. */
export function HelpItem({ reportPath }: { reportPath: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (insecure context, permissions) - no-op, never fake success
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
    >
      {copied ? (
        <Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ok" />
      ) : (
        <HelpCircle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-secondary" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-secondary">{copied ? "Path copied" : "Help & support"}</span>
        <span className="block truncate text-[11px] text-faint">{reportPath}</span>
      </span>
    </button>
  );
}
