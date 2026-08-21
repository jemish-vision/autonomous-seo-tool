/** Integration addition (sagardalwala.me test): mailto:/tel: anchors are deliberately not
 * LinkRecords — they surface here as contact evidence instead of vanishing entirely. */
import type { CheerioAPI } from "cheerio";
import type { ContactRecord } from "../models/types";

function stripScheme(href: string, scheme: string): string {
  const rest = href.slice(scheme.length);
  const qIndex = rest.indexOf("?");
  return decodeURIComponent(qIndex === -1 ? rest : rest.slice(0, qIndex)).trim();
}

export function extractContacts($: CheerioAPI): ContactRecord[] {
  const out: ContactRecord[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const lower = href.toLowerCase();
    let record: ContactRecord | null = null;
    if (lower.startsWith("mailto:")) {
      const value = stripScheme(href, "mailto:");
      if (value) record = { kind: "email", value, href, anchor: $(el).text().trim() };
    } else if (lower.startsWith("tel:")) {
      const value = stripScheme(href, "tel:");
      if (value) record = { kind: "phone", value, href, anchor: $(el).text().trim() };
    }
    if (!record) return;
    const key = `${record.kind}:${record.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(record);
  });
  return out;
}
