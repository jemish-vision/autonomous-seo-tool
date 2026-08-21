import { supabase } from "./supabase";

/**
 * The single fetch wrapper every data hook uses.
 *
 * - Prepends VITE_API_BASE (blank in dev — Vite proxies /api to the Express server).
 * - Attaches the Supabase access token as `Authorization: Bearer <jwt>` so the API's requireAuth
 *   middleware can identify the user. This is the browser half of the auth handshake.
 * - Throws ApiError on non-2xx so React Query surfaces it.
 */
const BASE = (import.meta.env.VITE_API_BASE as string) ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(await authHeader()) },
  });
  return handle<T>(res);
}

export async function apiSend<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error ?? data.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
