import type { CheerioAPI } from "cheerio";
import type { VideoRecord } from "../models/types";
import { resolveAbsolute } from "./shared";

const YOUTUBE_RE = /(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i;
const VIMEO_RE = /player\.vimeo\.com\/video\/(\d+)/i;
/** Fallback bucket for embeds that are clearly a video player but not YouTube/Vimeo. */
const VIDEOISH_RE = /video|dailymotion|wistia|loom|brightcove|jwplayer/i;
const SKIPPABLE_SCHEME_RE = /^(data|blob):/i;

function resolveIfUsable(raw: string | undefined, base: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || SKIPPABLE_SCHEME_RE.test(trimmed)) return null;
  return resolveAbsolute(trimmed, base);
}

export function extractVideos($: CheerioAPI, base: string): VideoRecord[] {
  const out: VideoRecord[] = [];
  const seen = new Set<string>();

  $("video").each((_, videoEl) => {
    const $video = $(videoEl);
    const poster = resolveIfUsable($video.attr("poster"), base);

    // one record per distinct resolved source URL: the tag's own src, then every child <source>
    const candidates: { srcRaw: string | undefined; mimeType: string | undefined }[] = [
      { srcRaw: $video.attr("src"), mimeType: $video.attr("type") },
    ];
    $video.find("source").each((_, sourceEl) => {
      candidates.push({ srcRaw: $(sourceEl).attr("src"), mimeType: $(sourceEl).attr("type") });
    });

    for (const c of candidates) {
      const url = resolveIfUsable(c.srcRaw, base);
      if (url === null || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, kind: "file", poster, mimeType: c.mimeType ?? null, providerId: null });
    }
  });

  $("iframe[src]").each((_, iframeEl) => {
    const srcRaw = $(iframeEl).attr("src");
    const url = resolveIfUsable(srcRaw, base);
    if (url === null || seen.has(url)) return;
    const trimmed = srcRaw!.trim(); // provider-id regexes match against the authored src, not the resolved URL

    const ytMatch = trimmed.match(YOUTUBE_RE);
    if (ytMatch) {
      seen.add(url);
      out.push({ url, kind: "youtube", poster: null, mimeType: null, providerId: ytMatch[1] ?? null });
      return;
    }
    const vimeoMatch = trimmed.match(VIMEO_RE);
    if (vimeoMatch) {
      seen.add(url);
      out.push({ url, kind: "vimeo", poster: null, mimeType: null, providerId: vimeoMatch[1] ?? null });
      return;
    }
    if (VIDEOISH_RE.test(trimmed)) {
      seen.add(url);
      out.push({ url, kind: "iframe", poster: null, mimeType: null, providerId: null });
    }
  });

  return out;
}
