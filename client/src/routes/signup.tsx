import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Lock, Mail, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { AuthVisual } from "@/components/auth/AuthVisual";

/** Signup route — ported from app/signup + components/auth/SignupForm. Design unchanged. */
export function SignupRoute() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    setPending(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    // If email confirmation is off, a session comes back immediately -> straight into the app.
    if (data.session) {
      navigate("/", { replace: true });
      return;
    }
    setNotice("Check your email to confirm your account, then sign in.");
  }

  return (
    <div className="grid h-dvh grid-cols-1 lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[368px]">
          <h1 className="text-2xl font-semibold leading-tight text-foreground">Create your account</h1>
          <p className="mt-1.5 text-sm text-secondary">Start analyzing your site&rsquo;s SEO.</p>

          <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="text-sm font-medium text-secondary">Email</label>
              <div className="mt-1.5 flex h-11 items-center gap-2.5 rounded-control border border-border bg-canvas px-3.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
                <Mail size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
                <input id="email" type="email" autoComplete="email" required disabled={pending} value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50" placeholder="you@example.com" />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium text-secondary">Password</label>
              <div className="mt-1.5 flex h-11 items-center gap-2.5 rounded-control border border-border bg-canvas px-3.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
                <Lock size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
                <input id="password" type="password" autoComplete="new-password" required disabled={pending} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50" placeholder="At least 6 characters" />
              </div>
            </div>

            {error ? (
              <div role="alert" className="flex items-start gap-2 rounded-control bg-danger-bg px-3 py-2 text-xs text-foreground">
                <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}
            {notice ? (
              <div className="rounded-control bg-ok-bg px-3 py-2 text-xs text-foreground">{notice}</div>
            ) : null}

            <Button type="submit" size="lg" disabled={pending} className="mt-2 w-full">
              {pending ? "Creating…" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-secondary">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-foreground underline-offset-2 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
      <div className="hidden lg:block">
        <AuthVisual />
      </div>
    </div>
  );
}
