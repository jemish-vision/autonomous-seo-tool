import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateExport, downloadExport, type ExportFormat } from "@/api/exports";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
];

/**
 * Server-side export of this run's issues dataset. Creates an export (build + serialize + upload via
 * the exports module), then downloads the resulting file. A small format menu offers CSV / JSON —
 * unlike the toolbar's client-side CSV (only the currently-filtered rows), this exports the full,
 * canonical issues dataset the server assembles.
 */
export function ExportButton({ runId }: { runId: string }) {
  const createExport = useCreateExport();
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // dismiss the menu on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pending = createExport.isPending || busyFormat !== null;

  async function run(format: ExportFormat) {
    setOpen(false);
    setError(false);
    setBusyFormat(format);
    try {
      const result = await createExport.mutateAsync({ runId, dataset: "issues", format });
      await downloadExport(result.id, `issues-${runId}.${format}`);
    } catch {
      setError(true);
    } finally {
      setBusyFormat(null);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={error ? "Export failed — try again" : "Export the issues dataset"}
      >
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
        {pending ? `Exporting ${busyFormat?.toUpperCase() ?? ""}…` : error ? "Export failed — retry" : "Export"}
      </Button>
      {open && !pending && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-card border border-border bg-card py-1 shadow-lg"
        >
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="menuitem"
              onClick={() => run(f.value)}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-xs text-foreground transition-colors duration-100 hover:bg-subtle"
            >
              Export as {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
