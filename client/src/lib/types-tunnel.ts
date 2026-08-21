/**
 * WordPress tunnel / pairing types — the dashboard half of the poll-based tunnel contract.
 *
 * The tunnel lets a WordPress site connect WITHOUT username/password: the dashboard generates a
 * pairing code (POST /api/tunnel/pair), the user pastes it into the WordPress plugin, and the plugin
 * verifies + heartbeats against the platform. These shapes mirror the Express tunnel module's
 * responses (server/src/modules/tunnel/tunnel.routes.ts).
 */

/** POST /api/tunnel/pair request body. */
export interface PairRequest {
  siteUrl: string;
  kind?: string;
  name?: string;
}

/** POST /api/tunnel/pair response — the code the user pastes into WordPress. */
export interface PairResponse {
  success: boolean;
  code: string;
  siteId: string;
  sourceId: string;
  siteUrl: string;
  expiresAt: string;
}

/** One paired site (token stripped), as returned by GET /api/tunnel/sites. */
export interface TunnelSite {
  id: string;
  source_id: string | null;
  kind: string;
  site_url: string;
  name: string;
  last_heartbeat: string | null;
  status: string;
}

/** GET /api/tunnel/sites response. */
export interface TunnelSitesResponse {
  success: boolean;
  sites: TunnelSite[];
  total: number;
  online: number;
  offline: number;
}
