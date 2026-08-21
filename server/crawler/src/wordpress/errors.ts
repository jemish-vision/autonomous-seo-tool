/**
 * Typed error for the autonomous-seo-connector API.
 *
 * Carries the connector's machine-readable code, HTTP status and any extra
 * error data (e.g. the before/after receipt attached to write_not_confirmed)
 * so callers can branch on codes instead of parsing messages.
 */

export interface ConnectorErrorBody {
  code: string;
  message: string;
  status: number;
  /** Extra fields from the connector's error envelope (receipts, etc.). */
  [key: string]: unknown;
}

export class ConnectorError extends Error {
  readonly code: string;
  /** HTTP status, or 0 for transport-level failures (no response received). */
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** The receipt the connector attached to a write_not_confirmed error, if any. */
  get receipt(): Record<string, unknown> | null {
    const changes = this.details.changes;
    return changes !== undefined && changes !== null ? ({ changes } as Record<string, unknown>) : null;
  }
}