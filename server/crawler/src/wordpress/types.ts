/**
 * Types for the autonomous-seo-connector REST API
 * (plugins/autonomous-seo-connector — namespace /wp-json/autonomous-seo/v1).
 *
 * Mirrors the connector's response envelope exactly:
 *   success:  { "success": true, ...payload, "timestamp": "..." }
 *   error:    { "success": false, "error": { "code", "message", "status", ...extra } }
 * Auth failures (401/403) come back in WordPress' standard error shape
 * { "code", "message", "data": { "status" } } instead.
 */

/** provider states from ProviderManager::state() */
export type SeoProviderState =
  | "yoast"
  | "rankmath"
  | "aioseo"
  | "unsupported_seo_provider"
  | "multiple_seo_providers_detected";

export interface ConnectorStatus {
  plugin: string;
  version: string;
  api_version: string;
  wordpress_version: string;
  php_version: string;
  status: "connected";
  seo_provider: SeoProviderState;
  woocommerce: boolean;
  timestamp: string;
}

export interface CapabilityFlags {
  read: boolean;
  write: boolean;
}

/** normalized field name -> read/write flags (GET /capabilities -> capabilities) */
export type CapabilityMatrix = Record<string, CapabilityFlags>;

export interface CapabilitiesResponse {
  wordpress: boolean;
  wordpress_version: string;
  pages: boolean;
  posts: boolean;
  custom_post_types: string[];
  media: boolean;
  woocommerce: boolean;
  woocommerce_version: string | null;
  seo_provider: SeoProviderState;
  seo_providers: string[];
  capabilities: CapabilityMatrix;
  timestamp: string;
}

export interface ResourceRef {
  type: string;
  id: number;
}

/** Normalized resource object (ResourceResolver::resource). */
export interface ResourceInfo extends ResourceRef {
  url: string;
  title: string;
  status: string;
  edit_link: string;
}

export interface ResolveUrlResponse {
  requested_url: string;
  resource: ResourceInfo;
  timestamp: string;
}

export interface GetResourceResponse {
  resource: ResourceInfo;
  timestamp: string;
}

export interface RobotsDirectives {
  index: boolean | null;
  follow: boolean | null;
}

/** Normalized SEO field values — scalars, null when unset, robots as an object. */
export type SeoFieldValue = string | number | boolean | null | RobotsDirectives | Record<string, unknown>;

export interface GetSeoResponse {
  resource: ResourceInfo;
  provider: string;
  seo: Record<string, SeoFieldValue>;
  timestamp: string;
}

/** One field's before/after pair from a write receipt. */
export interface ReceiptChange {
  before: unknown;
  after: unknown;
}

/** The connector's before/after receipt: field -> { before, after }. */
export type ChangeReceipt = Record<string, ReceiptChange>;

export interface WriteReceipt {
  resource: ResourceRef;
  provider?: string;
  operation: "update_seo" | "update_media";
  changes: ChangeReceipt;
  timestamp: string;
}

export interface MediaInfo {
  id: number;
  url: string;
  alt_text: string;
  caption: string;
  title: string;
  mime: string;
  width: number | null;
  height: number | null;
  edit_link: string;
}

export interface GetMediaResponse {
  media: MediaInfo;
  timestamp: string;
}