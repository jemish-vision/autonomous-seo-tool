import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Mail, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/auth-browser";
import { Button } from "@/components/ui/button";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setPending(false);
      setError(signInError.message);
      return;
    }

    navigate(nextPath);
    // Server Components cache their render — refresh() re-runs them against the now-set cookie.
  }

  return (
    <div className="w-full max-w-[368px]">
      <h1 className="text-2xl font-semibold leading-tight text-foreground">Welcome back</h1>
      <p className="mt-1.5 text-sm text-secondary">Sign in to continue to your dashboard.</p>

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-secondary">
            Email
          </label>
          <div className="mt-1.5 flex h-11 items-center gap-2.5 rounded-control border border-border bg-canvas px-3.5 transition-colors duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
            <Mail size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
              placeholder="you@example.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="text-sm font-medium text-secondary">
            Password
          </label>
          <div className="mt-1.5 flex h-11 items-center gap-2.5 rounded-control border border-border bg-canvas px-3.5 transition-colors duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
            <Lock size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>
        </div>

        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-control bg-danger-bg px-3 py-2 text-xs text-foreground">
            {/* Icon carries the danger color (graphics need only 3:1); message text stays
                text-foreground so it clears the 4.5:1 body-text floor — text-danger on
                danger-bg measures 4.23:1, below floor, on this specific light bg-canvas page. */}
            <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <Button type="submit" size="lg" disabled={pending} className="mt-2 w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-secondary">
        Don&rsquo;t have an account?{" "}
        <a href="/signup" className="font-medium text-foreground underline-offset-2 hover:underline">
          Sign up
        </a>
      </p>
    </div>
  );
}
