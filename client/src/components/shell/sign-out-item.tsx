import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

/** The only sign-out affordance in the authenticated shell. Clears the Supabase browser session
 *  client-side, then navigates to /login. Real <button>, so Tab/Enter/Space all work natively. */
export function SignOutItem() {
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  async function handleSignOut() {
    setPending(true);
    try {
      await supabase.auth.signOut();
    } finally {
      navigate("/login");
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleSignOut}
      className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm text-secondary outline-none transition-colors duration-150 hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50"
    >
      <LogOut size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
