import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@/lib/auth-browser";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    navigate("/login");
    // Server Components cache their render — refresh() re-runs them against the now-cleared cookie.
  }

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={handleSignOut} className="w-full">
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
