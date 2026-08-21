/**
 * Source abstraction types — the platform-neutral contract that WordPress,
 * Shopify, and any future CMS/e-commerce connector must satisfy.
 *
 * A "source" is a connected external site the platform can read/write SEO
 * data against. Each source has a kind (wordpress, shopify, ...), credentials,
 * and a set of capabilities that the connector reports at connection time.
 */

// ── Source kinds ──────────────────────────────────────────────────────────

export type SourceKind = "wordpress" | "shopify";

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
};

// ── Persisted config (stored in storage/sources.json) ─────────────────────

export interface SourceConfig {
  /** Stable id, e.g. "wp-abc123" or "shopify-my-store". */
  id: string;
  kind: SourceKind;
  /** Human-readable display name. */
  name: string;
  /** Site origin, e.g. "https://example.com". */
  siteUrl: string;
  /**
   * Credentials — stored encrypted at rest (future) or read from env vars.
   * Shape depends on kind:
   *   wordpress: { username, appPassword, apiKey? }
   *   shopify:   { apiKey, apiSecret, accessToken }
   */
  credentials: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// ── Live status (from connector health check) ─────────────────────────────

export type SourceConnectionState = "connected" | "disconnected" | "error" | "unchecked";

export interface SourceStatus {
  sourceId: string;
  state: SourceConnectionState;
  /** When the last connection check succeeded or failed. */
  lastCheckedAt: string | null;
  /** Human-readable error when state === "error". */
  error?: string;
  /** Connector-reported metadata (plugin version, WP version, etc.). */
  meta?: Record<string, unknown>;
}

// ── Capabilities (reported by the connector at /capabilities) ──────────────

export interface SourceCapabilityFlags {
  read: boolean;
  write: boolean;
}

export type CapabilityMatrix = Record<string, SourceCapabilityFlags>;

export interface SourceCapabilities {
  sourceId: string;
  wordpress?: boolean;
  wordpressVersion?: string;
  pages?: boolean;
  posts?: boolean;
  customPostTypes?: string[];
  media?: boolean;
  woocommerce?: boolean;
  woocommerceVersion?: string | null;
  seoProvider?: string;
  capabilities?: CapabilityMatrix;
  fetchedAt: string;
}

// ── Resource reference (for read/write operations) ────────────────────────

export interface SourceResourceRef {
  sourceId: string;
  type: string;
  resourceId: number;
}

export interface SourceResourceInfo extends SourceResourceRef {
  url: string;
  title: string;
  status: string;
  editLink: string;
}

// ── SEO field values (platform-neutral) ───────────────────────────────────

export type SourceSeoFieldValue = string | number | boolean | null | Record<string, unknown>;

export interface SourceSeoData {
  resource: SourceResourceInfo;
  provider: string;
  seo: Record<string, SourceSeoFieldValue>;
  fetchedAt: string;
}

// ── Write receipt ─────────────────────────────────────────────────────────

export interface SourceReceiptChange {
  before: unknown;
  after: unknown;
}

export type SourceChangeReceipt = Record<string, SourceReceiptChange>;

export interface SourceWriteReceipt {
  resource: { type: string; id: number };
  provider?: string;
  operation: "update_seo" | "update_media";
  changes: SourceChangeReceipt;
  timestamp: string;
}

// ── API request/response shapes ───────────────────────────────────────────

export interface CreateSourceRequest {
  kind: SourceKind;
  name: string;
  siteUrl: string;
  credentials: Record<string, string>;
}

export interface UpdateSourceRequest {
  name?: string;
  siteUrl?: string;
  credentials?: Record<string, string>;
}

export interface ConnectSourceRequest {
  /** Force a re-check even if recently checked. */
  force?: boolean;
}

export interface WriteSeoRequest {
  type: string;
  id: number;
  changes: Record<string, unknown>;
  provider?: string;
}
