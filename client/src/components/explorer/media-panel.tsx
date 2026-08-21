import { useEffect, useState } from "react";
import { ExternalLink, Film, ImageOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { CrawledPageWithId, VideoKind } from "@/lib/types";

const PROVIDER_LABEL: Record<VideoKind, string> = {
  file: "File",
  youtube: "YouTube",
  vimeo: "Vimeo",
  iframe: "Embed",
};

function YoutubeThumb({ providerId, url }: { providerId: string; url: string }) {
  const thumbUrl = `https://img.youtube.com/vi/${providerId}/hqdefault.jpg`;
  const [status, setStatus] = useState<"loading" | "ok" | "broken">("loading");
  const [mountedSrc, setMountedSrc] = useState<string | null>(null);

  // See ImageThumb for why `src` is deferred to a post-mount effect rather than rendered
  // up-front: it makes the <img> a client-created element so onError can't lose the race against
  // a fetch the browser already started from server-rendered HTML during hydration.
  useEffect(() => {
    setStatus("loading");
    setMountedSrc(thumbUrl);
  }, [thumbUrl]);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block aspect-video w-full overflow-hidden rounded-control border border-border bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {status === "broken" ? (
        <div className="flex h-full w-full items-center justify-center">
          <ImageOff size={20} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
        </div>
      ) : mountedSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- external thumbnail, no network call needed to derive it
        <img
          src={mountedSrc}
          alt="YouTube video thumbnail"
          className="h-full w-full object-cover"
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("broken")}
        />
      ) : (
        <Skeleton className="h-full w-full rounded-none" />
      )}
    </a>
  );
}

function VideoCard({ video }: { video: NonNullable<CrawledPageWithId["videos"]>[number] }) {
  return (
    <div className="overflow-hidden rounded-control border border-border bg-subtle">
      {video.kind === "file" ? (
        <video preload="metadata" controls muted poster={video.poster ?? undefined} className="max-h-48 w-full bg-black">
          <source src={video.url} type={video.mimeType ?? undefined} />
        </video>
      ) : video.kind === "youtube" && video.providerId ? (
        <YoutubeThumb providerId={video.providerId} url={video.url} />
      ) : (
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex aspect-video w-full items-center justify-center gap-2 text-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Film size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs">No inline preview — open source</span>
        </a>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <Badge tone="neutral">{PROVIDER_LABEL[video.kind]}</Badge>
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 truncate text-xs text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="truncate">{video.url}</span>
          <ExternalLink size={12} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

export function MediaPanel({ page }: { page: CrawledPageWithId }) {
  const videos = page.videos;
  const notCaptured = videos === undefined;

  return (
    <Card id="media">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-faint">Media</h2>
        <span className="text-xs tabular-nums text-faint">
          {page.images.length} image(s) · {notCaptured ? "—" : videos.length} video(s)
        </span>
      </div>
      {notCaptured ? (
        <p className="text-sm text-faint">Not captured in this run (re-crawl to capture media).</p>
      ) : videos.length === 0 ? (
        <p className="text-sm text-faint">No videos found on this page. Image previews are in the Images section above.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v, i) => (
            <VideoCard key={`${v.url}-${i}`} video={v} />
          ))}
        </div>
      )}
    </Card>
  );
}
