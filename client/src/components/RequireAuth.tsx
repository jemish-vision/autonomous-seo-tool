import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth";

/**
 * Route guard — the client half of the old proxy.ts default-deny gate. No session -> bounce to
 * /login with a `next` param so the user returns where they were headed. The API enforces the
 * same rule server-side (requireAuth), so this is UX, not the security boundary.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="grid h-dvh place-items-center text-sm text-secondary">Loading…</div>;
  }
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
