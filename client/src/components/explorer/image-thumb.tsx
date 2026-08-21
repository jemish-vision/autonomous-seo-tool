import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/** Fixed 56px box reserves space (zero CLS) and swaps to a fallback icon on load error.
 *  Crawled src is arbitrary third-party content — a plain <img> is safe (no markup execution).
 *
 *  The <img> is NOT rendered with `src` on first paint. If it were, the browser starts fetching
 *  straight from the server-rendered HTML during initial parse — often finishing (success OR a
 *  fast cross-origin 404/ORB-block) before React hydrates and attaches this element's onError,
 *  which for a non-bubbling event like `error` is wired directly to that DOM node, not delegated
 *  from the root. A failure that resolves first is silently lost. Deferring `src` to a post-mount
 *  effect makes the <img> a client-created element instead: React sets attributes and attaches
 *  the listener in the same synchronous commit, strictly before the browser can start the fetch
 *  (network responses always land in a later task), so there is no window to lose the event. */
export function ImageThumb({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<"loading" | "ok" | "broken">("loading");
  const [mountedSrc, setMountedSrc] = useState<string | null>(null);

  useEffect(() => {
    setStatus("loading");
    setMountedSrc(src);
  }, [src]);

  if (status === "broken") {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-control border border-border bg-subtle">
        <ImageOff size={16} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
      </div>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="block h-14 w-14 shrink-0 overflow-hidden rounded-control border border-border bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Open full-size image: ${alt || src}`}
    >
      {mountedSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- external crawled asset, not a local/optimizable src
        <img
          src={mountedSrc}
          alt={alt}
          width={56}
          height={56}
          className="h-14 w-14 object-cover"
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("broken")}
        />
      ) : (
        <Skeleton className="h-14 w-14" />
      )}
    </a>
  );
}
