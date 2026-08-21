/**
 * Client-side fetch helpers for the /gsc UI. Mirrors the server's lib/gsc
 * response shapes; the session cookie is sent automatically (same-origin).
 */

export interface GscSite {
  domain: string;
  startUrl: string | null;
  runCount: number;
  lastCrawledAt: string | null;
  linkedSiteUrl: string | null;
}

export interface GscStatus {
  configured: boolean;
  connected: boolean;
  connection: { id: string; googleEmail: string | null; scopes: string; createdAt: string } | null;
  setupHint: string | null;
}

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
  propertyType: "domain" | "url_prefix";
  canReadData: boolean;
  linkedDomain: string | null;
  suggestedDomains: string[];
}

export interface GscSyncResult {
  siteUrl: string;
  startDate: string;
  endDate: string;
  rowsFetched: number;
  rowsWritten: number;
  pages: number;
  totalClicks: number;
  totalImpressions: number;
  breakdowns: Record<string, number>;
}

export interface GscDateRange {
  startDate: string;
  endDate: string;
  latestAvailable: string;
  provisionalStart: string;
  clampedReason: string | null;
}

export type GscVerdict = "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL" | "VERDICT_UNSPECIFIED";

export interface GscInspection {
  pageUrl: string;
  verdict: GscVerdict;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  sitemaps: string[] | null;
  raw: Record<string, unknown> | null;
  inspectedAt: string;
}

export interface GscInspectionRunResult {
  inspected: number;
  failed: number;
  remaining: number;
  quotaUsedToday: number;
  quotaRemainingToday: number;
  stoppedReason: string | null;
  quotaDisagreement: boolean;
  byVerdict: Record<string, number>;
}

export interface GscPageMetric {
  pageUrl: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  days: number;
}

export interface GscBreakdownRow {
  dimension: "query" | "device" | "country" | "searchAppearance";
  keyValue: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscMetricsResponse {
  property: { siteUrl: string; propertyType: string; lastSyncedAt: string | null };
  range: GscDateRange;
  searchType: "web" | "image";
  fetchedLive: boolean;
  partial: boolean;
  totals: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    pages: number;
    firstDate: string | null;
    lastDate: string | null;
  } | null;
  trend: Array<{ date: string; clicks: number; impressions: number }>;
  pages: GscPageMetric[];
  queries: GscBreakdownRow[];
  devices: GscBreakdownRow[];
  countries: GscBreakdownRow[];
  searchAppearances: GscBreakdownRow[];
  inspections: GscInspection[];
  coverage: Array<{ verdict: GscVerdict; coverageState: string | null; count: number }>;
}

import { supabase } from "@/lib/supabase";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Attach the Supabase access token as a Bearer header — the API's requireAuth gate needs it
  // (the old app relied on a same-origin session cookie, which this app does not use).
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message ?? body?.error ?? `Request failed with status ${res.status}`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export function getGscStatus() {
  return request<GscStatus>("/api/gsc/status");
}

export function getGscAuthUrl() {
  return request<{ authUrl: string }>("/api/gsc/connect");
}

export function getGscProperties() {
  return request<{ properties: GscProperty[] }>("/api/gsc/properties");
}

export function getGscSites() {
  return request<{ sites: GscSite[] }>("/api/gsc/sites");
}

export function linkGscProperty(domain: string, siteUrl: string) {
  return request<{ property: unknown }>("/api/gsc/link", {
    method: "POST",
    body: JSON.stringify({ domain, siteUrl }),
  });
}

export function unlinkGscProperty(domain: string) {
  return request<{ unlinked: true }>(`/api/gsc/link?domain=${encodeURIComponent(domain)}`, { method: "DELETE" });
}

export function disconnectGsc() {
  return request<{ disconnected: true }>("/api/gsc/connection", { method: "DELETE" });
}

export function syncGscMetrics(domain: string) {
  return request<GscSyncResult>(`/api/gsc/sync/${encodeURIComponent(domain)}`, { method: "POST" });
}

export function getGscMetrics(domain: string, range?: { start: string; end: string }, searchType: "web" | "image" = "web") {
  const p = new URLSearchParams({ type: searchType });
  if (range) {
    p.set("start", range.start);
    p.set("end", range.end);
  }
  return request<GscMetricsResponse>(`/api/gsc/metrics/${encodeURIComponent(domain)}?${p.toString()}`);
}

export function inspectGscUrls(domain: string, batchSize?: number) {
  return request<GscInspectionRunResult>(`/api/gsc/inspect/${encodeURIComponent(domain)}`, {
    method: "POST",
    body: JSON.stringify(batchSize ? { batchSize } : {}),
  });
}

export function crawlGscReason(domain: string, reason: string, pageUrls: string[]) {
  return request<{ runId: string; urlsQueued: number }>(`/api/gsc/crawl-reason/${encodeURIComponent(domain)}`, {
    method: "POST",
    body: JSON.stringify({ reason, pageUrls }),
  });
}
