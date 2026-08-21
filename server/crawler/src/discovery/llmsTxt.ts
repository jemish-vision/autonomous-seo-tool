/**
 * `/llms.txt` — reported for information only, with an explicit zero score weight.
 *
 * Google's AI-optimization guidance (updated 2026-06-29) states Search ignores the file, and that
 * publishing one neither helps nor harms visibility there. It is still recorded, because a site
 * that has one usually made a deliberate decision worth surfacing (other AI services may read it)
 * — just never one that should move a score. No rule in this codebase's rulebook may score
 * llms.txt presence/absence; it exists in evidence only.
 */
import type { LlmsTxtInfo } from "../models/types";
import { fetchWithTimeout } from "./http";

export async function fetchLlmsTxt(origin: string, userAgent: string): Promise<LlmsTxtInfo> {
  const url = new URL("/llms.txt", origin).toString();
  const fetchedAt = new Date().toISOString();

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { "user-agent": userAgent } });
  } catch {
    return { present: false, url, statusCode: null, bytes: 0, content: null, fetchedAt };
  }

  if (res.status !== 200) {
    return { present: false, url, statusCode: res.status, bytes: 0, content: null, fetchedAt };
  }

  const body = await res.text();
  // A 200 that is really an HTML error page (SPA catch-all, custom 404) is common, so the body
  // must not look like HTML before it counts as a real llms.txt.
  const looksLikeHtml = /^\s*(<!doctype html|<html)/i.test(body);
  const present = !looksLikeHtml && body.trim().length > 0;
  // The body is stored with the evidence so the dashboard can show the actual file (content is
  // null when absent — never fabricated). Optional on the type so robots.json written by older
  // crawler versions parse unchanged (metadata only).
  return { present, url, statusCode: res.status, bytes: Buffer.byteLength(body), content: present ? body : null, fetchedAt };
}
