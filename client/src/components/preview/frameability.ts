/** Whether the LIVE page can be embedded, decided from the response headers we already stored —
 * so we never render an iframe that will silently show a blank box. A framing refusal produces no
 * catchable error in the embedding page, which is exactly why this is a pre-flight check. */
/** Only ever frame http(s). A javascript: or data: src in an iframe carrying allow-same-origin
 * executes in OUR origin — the crawler should only ever store http(s), but the preview must not
 * depend on that holding for every stored record, past or future. */
export function isFrameableScheme(url: string): boolean {
  try {
    const scheme = new URL(url).protocol;
    return scheme === "http:" || scheme === "https:";
  } catch {
    return false;
  }
}

export function frameability(
  headers: Record<string, string> | undefined | null,
  pageUrl?: string,
): {
  canFrameLive: boolean;
  frameBlockedBy: string | null;
} {
  if (pageUrl !== undefined && !isFrameableScheme(pageUrl)) {
    return { canFrameLive: false, frameBlockedBy: "Only http(s) URLs can be embedded" };
  }

  const h = headers ?? {};
  const xfo = h["x-frame-options"];
  if (xfo && xfo.trim()) {
    return { canFrameLive: false, frameBlockedBy: `X-Frame-Options: ${xfo.trim()}` };
  }

  const csp = h["content-security-policy"];
  const ancestors = csp ? /frame-ancestors([^;]*)/i.exec(csp) : null;
  if (ancestors) {
    const value = ancestors[1]!.trim();
    // A bare * permits any embedder; anything else is an allow-list we are almost certainly not on.
    if (value !== "*") {
      return { canFrameLive: false, frameBlockedBy: `CSP frame-ancestors ${value || "'none'"}` };
    }
  }

  return { canFrameLive: true, frameBlockedBy: null };
}
