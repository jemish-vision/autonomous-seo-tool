/**
 * Client for the autonomous-seo-connector WordPress plugin REST API.
 *
 * Talks to /wp-json/autonomous-seo/v1/* using WordPress Application Passwords
 * (HTTP Basic) plus the optional shared X-ASC-API-Key header. Every response
 * is validated against the connector's envelope; WordPress' own error shape
 * (auth failures) is mapped onto the same ConnectorError so callers never
 * branch on transport quirks.
 *
 * The connector is the WordPress half of the Fix & Apply bridge — this client
 * is the platform half. It never guesses: whatever the connector rejects
 * (unsupported fields, unresolved URLs, write-not-confirmed) surfaces as a
 * typed ConnectorError carrying the connector's code and status.
 */
import { ConnectorError } from "./errors";
import type {
  CapabilitiesResponse,
  ConnectorStatus,
  GetMediaResponse,
  GetResourceResponse,
  GetSeoResponse,
  ResolveUrlResponse,
  ResourceRef,
  WriteReceipt,
} from "./types";

export interface WordPressConfig {
  /** Site origin, e.g. "https://example.com" (trailing slash allowed). */
  siteUrl: string;
  /** WordPress user (least privilege: Editor role). */
  username: string;
  /** WordPress Application Password for that user. */
  appPassword: string;
  /** Optional shared API key configured on the connector's settings page. */
  apiKey?: string;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
}

const NAMESPACE = "/wp-json/autonomous-seo/v1";

/** Any JSON body the connector may return — envelope fields are optional here
 * because WordPress' own error bodies have a different shape. */
interface JsonBody {
  success?: boolean;
  error?: { code?: string; message?: string; status?: number; [key: string]: unknown };
  code?: string;
  message?: string;
  data?: { status?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export class WordPressClient {
  private readonly config: WordPressConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly origin: string;

  /** Normalized site origin, e.g. "https://example.com" — safe to store in evidence. */
  get siteOrigin(): string {
    return this.origin;
  }

  constructor(config: WordPressConfig, fetchImpl: typeof fetch = fetch) {
    let parsed: URL;
    try {
      parsed = new URL(config.siteUrl);
    } catch {
      throw new ConnectorError("invalid_config", `siteUrl must be an absolute http(s) URL (got "${config.siteUrl}")`, 0);
    }
    if (parsed.origin === "null" || !/^https?:$/.test(parsed.protocol)) {
      throw new ConnectorError("invalid_config", `siteUrl must be an absolute http(s) URL (got "${config.siteUrl}")`, 0);
    }
    this.origin = parsed.origin;
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** GET /status — connection + version + detected SEO provider. */
  async status(): Promise<ConnectorStatus> {
    return this.request<ConnectorStatus>("GET", "/status");
  }

  /** GET /capabilities — what this site safely supports. */
  async capabilities(): Promise<CapabilitiesResponse> {
    return this.request<CapabilitiesResponse>("GET", "/capabilities");
  }

  /** POST /resolve-url — resolve a public URL to the WordPress resource owning it. */
  async resolveUrl(url: string): Promise<ResolveUrlResponse> {
    return this.request<ResolveUrlResponse>("POST", "/resolve-url", { url });
  }

  /** GET /resource/{type}/{id} — resource info. */
  async getResource(type: string, id: number): Promise<GetResourceResponse> {
    return this.request<GetResourceResponse>("GET", `/resource/${type}/${id}`);
  }

  /** GET /resource/{type}/{id}/seo — read the supported SEO fields. */
  async getSeo(type: string, id: number): Promise<GetSeoResponse> {
    return this.request<GetSeoResponse>("GET", `/resource/${type}/${id}/seo`);
  }

  /**
   * POST /resource/{type}/{id}/seo — write supported SEO fields and get the
   * before/after receipt. Pass `provider` explicitly when the site has more
   * than one supported SEO provider active (the connector rejects the write
   * with multiple_seo_providers_detected otherwise).
   */
  async updateSeo(
    type: string,
    id: number,
    changes: Record<string, unknown>,
    provider?: string,
  ): Promise<WriteReceipt> {
    const body: Record<string, unknown> = { changes };
    if (provider !== undefined) body.provider = provider;
    return this.request<WriteReceipt>("POST", `/resource/${type}/${id}/seo`, body);
  }

  /** GET /media/{id} — attachment info including alt text. */
  async getMedia(id: number): Promise<GetMediaResponse> {
    return this.request<GetMediaResponse>("GET", `/media/${id}`);
  }

  /** POST /media/{id} — update alt text (the only writable media field). */
  async updateMedia(id: number, changes: Record<string, unknown>): Promise<WriteReceipt> {
    return this.request<WriteReceipt>("POST", `/media/${id}`, { changes });
  }

  /** Convenience: resolve a URL and return just the owning resource. */
  async resolveResource(url: string): Promise<ResourceRef> {
    const { resource } = await this.resolveUrl(url);
    return { type: resource.type, id: resource.id };
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.appPassword}`).toString("base64")}`,
    };
    if (this.config.apiKey) {
      headers["X-ASC-API-Key"] = this.config.apiKey;
    }

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.origin}${NAMESPACE}${path}`, init);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ConnectorError("request_failed", `Request to ${path} failed: ${reason}`, 0);
    }

    let json: JsonBody;
    try {
      json = (await res.json()) as JsonBody;
    } catch {
      throw new ConnectorError(
        "invalid_response",
        `${method} ${path} returned HTTP ${res.status} with a non-JSON body.`,
        res.status,
      );
    }

    // Connector error envelope: { success: false, error: { code, message, status, ... } }
    if (json.success === false && json.error) {
      const e = json.error;
      if (typeof e.code === "string") {
        throw new ConnectorError(
          e.code,
          typeof e.message === "string" ? e.message : "Connector error.",
          typeof e.status === "number" ? e.status : res.status,
          e,
        );
      }
    }

    // WordPress standard error shape (auth layer): { code, message, data: { status } }
    if (typeof json.code === "string" && typeof json.message === "string" && json.success === undefined) {
      const status = json.data?.status ?? res.status;
      throw new ConnectorError(json.code, json.message, status, { status });
    }

    if (json.success !== true) {
      throw new ConnectorError(
        "invalid_response",
        `${method} ${path} returned HTTP ${res.status} with an unrecognized body.`,
        res.status,
      );
    }

    // Strip only the envelope's "success" marker — the payload includes the
    // connector's authoritative "timestamp", which write receipts carry.
    const { success: _success, ...payload } = json;
    return payload as unknown as T;
  }
}