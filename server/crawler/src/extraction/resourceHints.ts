/** Static script/stylesheet/preload inventory, parsed from markup alone — no browser needed, so
 * it's populated on every page (static or rendered pass alike), unlike the lab-vitals fields. */
import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  PreloadResourceRecord,
  ResourceHints,
  ScriptResourceRecord,
  StylesheetResourceRecord,
} from "../models/types";
import { resolveAbsolute } from "./shared";

/** media values that never block first paint on a typical screen visit. Coarse on purpose: a full
 * media-query evaluation needs a real viewport, which a static parse doesn't have. */
const NON_BLOCKING_MEDIA_RE = /^(print|speech)$/i;

function resolvedOrRaw(raw: string, base: string): string {
  return resolveAbsolute(raw, base) ?? raw;
}

function inHead($: CheerioAPI, el: AnyNode): boolean {
  return $(el).parents("head").length > 0;
}

function extractScripts($: CheerioAPI, base: string): ScriptResourceRecord[] {
  const out: ScriptResourceRecord[] = [];
  $("script").each((_, el) => {
    const $el = $(el);
    const srcRaw = $el.attr("src");
    const type = ($el.attr("type") ?? "").trim().toLowerCase();
    // JSON-LD/importmap/speculationrules etc. are data blocks, not executable render-blocking code.
    if (type && !/^(module|text\/javascript|application\/javascript)$/.test(type)) return;
    const module = type === "module";
    const async = $el.attr("async") !== undefined;
    const defer = $el.attr("defer") !== undefined;
    const head = inHead($, el);
    const url = srcRaw && srcRaw.trim() ? resolvedOrRaw(srcRaw.trim(), base) : null;
    const inlineBytes = url === null ? Buffer.byteLength($el.html() ?? "", "utf8") : null;
    out.push({
      url,
      async,
      defer,
      module,
      inHead: head,
      inlineBytes,
      renderBlocking: url !== null && !async && !defer && !module && head,
    });
  });
  return out;
}

function extractStylesheets($: CheerioAPI, base: string): StylesheetResourceRecord[] {
  const out: StylesheetResourceRecord[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const $el = $(el);
    const hrefRaw = $el.attr("href");
    if (!hrefRaw || !hrefRaw.trim()) return;
    const media = $el.attr("media")?.trim() || null;
    const head = inHead($, el);
    out.push({
      url: resolvedOrRaw(hrefRaw.trim(), base),
      media,
      inHead: head,
      renderBlocking: head && !(media && NON_BLOCKING_MEDIA_RE.test(media)),
    });
  });
  return out;
}

function extractPreloads($: CheerioAPI, base: string): PreloadResourceRecord[] {
  const out: PreloadResourceRecord[] = [];
  $('link[rel="preload"]').each((_, el) => {
    const $el = $(el);
    const hrefRaw = $el.attr("href");
    if (!hrefRaw || !hrefRaw.trim()) return;
    out.push({
      url: resolvedOrRaw(hrefRaw.trim(), base),
      as: $el.attr("as")?.trim() || null,
      type: $el.attr("type")?.trim() || null,
      crossorigin: $el.attr("crossorigin")?.trim() || null,
    });
  });
  return out;
}

export function extractResourceHints($: CheerioAPI, base: string): ResourceHints {
  const scripts = extractScripts($, base);
  const stylesheets = extractStylesheets($, base);
  return {
    scripts,
    stylesheets,
    preloads: extractPreloads($, base),
    inlineScriptBytesTotal: scripts.reduce((n, s) => n + (s.inlineBytes ?? 0), 0),
    renderBlockingScriptCount: scripts.filter((s) => s.renderBlocking).length,
    renderBlockingStylesheetCount: stylesheets.filter((s) => s.renderBlocking).length,
  };
}
