import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Mail, AlertCircle, MailCheck } from "lucide-react";
import { createClient } from "@/lib/auth-browser";
import { Button } from "@/components/ui/button";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type Field = "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<Field, string>>;

function validate(email: string, password: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email) errors.email = "Email is required.";
  else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

  if (!password) errors.password = "Password is required.";
  else if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

  if (!confirmPassword) errors.confirmPassword = "Confirm your password.";
  else if (password && confirmPassword !== password) errors.confirmPassword = "Passwords don't match.";

  return errors;
}

function FieldError({ id, message }: { id: string; message: string }) {
  // Icon carries the danger color (graphics need only 3:1); message text stays text-foreground —
  // same split LoginForm's alert uses, since text-danger measures under the 4.5:1 body-text floor
  // against this page's light backgrounds.
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1 text-xs text-foreground">
      <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 text-danger" aria-hidden="true" />
      {message}
    </p>
  );
}

export function SignupForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const fieldErrors = validate(email, password, confirmPassword);

  function markTouched(field: Field) {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setTouched({ email: true, password: true, confirmPassword: true });

    if (Object.keys(validate(email, password, confirmPassword)).length > 0) return;

    setPending(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setPending(false);
      setFormError(error.message);
      return;
    }

    // Supabase's anti-enumeration behavior: signUp() against an email that already has a
    // CONFIRMED account returns no error, but an empty identities array on a throwaway user
    // object — the alternative (a real "already registered" error) would let an attacker probe
    // which emails exist. Verified against this project: this is the only reliable signal.
    if (data.user?.identities?.length === 0) {
      setPending(false);
      setFormError("An account with this email already exists. Try signing in instead.");
      return;
    }

    setPending(false);

    if (data.session) {
      // Email confirmation is off for this project — the account is already active.
      navigate("/");
      return;
    }

    // Verified project behavior: confirmation is required, so the account can't sign in yet.
    setConfirmationSent(true);
  }

  if (confirmationSent) {
    return (
      <div className="w-full max-w-[368px]">
        <div className="flex h-11 w-11 items-center justify-center rounded-control bg-subtle">
          <MailCheck size={20} strokeWidth={1.75} className="text-primary" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold leading-tight text-foreground">Check your email</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-secondary">
          We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Confirm your
          address to finish creating your account, then sign in.
        </p>
        <a
          href="/login"
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-control bg-primary px-3.5 text-sm font-medium text-primary-contrast transition hover:brightness-110"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[368px]">
      <h1 className="text-2xl font-semibold leading-tight text-foreground">Create an account</h1>
      <p className="mt-1.5 text-sm text-secondary">Sign up to start exploring your crawl data.</p>

      <form onSubmit={handleSubmit} noValidate className="mt-7 flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-secondary">
            Email
          </label>
          <div
            className={`mt-1.5 flex h-11 items-center gap-2.5 rounded-control border bg-canvas px-3.5 transition-colors duration-150 focus-within:ring-2 focus-within:ring-primary/30 ${
              touched.email && fieldErrors.email ? "border-danger" : "border-border focus-within:border-primary"
            }`}
          >
            <Mail size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => markTouched("email")}
              aria-invalid={Boolean(touched.email && fieldErrors.email)}
              aria-describedby={touched.email && fieldErrors.email ? "email-error" : undefined}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
              placeholder="you@example.com"
            />
          </div>
          {touched.email && fieldErrors.email ? <FieldError id="email-error" message={fieldErrors.email} /> : null}
        </div>

        <div>
          <label htmlFor="password" className="text-sm font-medium text-secondary">
            Password
          </label>
          <div
            className={`mt-1.5 flex h-11 items-center gap-2.5 rounded-control border bg-canvas px-3.5 transition-colors duration-150 focus-within:ring-2 focus-within:ring-primary/30 ${
              touched.password && fieldErrors.password ? "border-danger" : "border-border focus-within:border-primary"
            }`}
          >
            <Lock size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              disabled={pending}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => markTouched("password")}
              aria-invalid={Boolean(touched.password && fieldErrors.password)}
              aria-describedby={touched.password && fieldErrors.password ? "password-error" : undefined}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>
          {touched.password && fieldErrors.password ? <FieldError id="password-error" message={fieldErrors.password} /> : null}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="text-sm font-medium text-secondary">
            Confirm password
          </label>
          <div
            className={`mt-1.5 flex h-11 items-center gap-2.5 rounded-control border bg-canvas px-3.5 transition-colors duration-150 focus-within:ring-2 focus-within:ring-primary/30 ${
              touched.confirmPassword && fieldErrors.confirmPassword ? "border-danger" : "border-border focus-within:border-primary"
            }`}
          >
            <Lock size={16} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              disabled={pending}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => markTouched("confirmPassword")}
              aria-invalid={Boolean(touched.confirmPassword && fieldErrors.confirmPassword)}
              aria-describedby={touched.confirmPassword && fieldErrors.confirmPassword ? "confirm-password-error" : undefined}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>
          {touched.confirmPassword && fieldErrors.confirmPassword ? (
            <FieldError id="confirm-password-error" message={fieldErrors.confirmPassword} />
          ) : null}
        </div>

        {formError ? (
          <div role="alert" className="flex items-start gap-2 rounded-control bg-danger-bg px-3 py-2 text-xs text-foreground">
            <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        ) : null}

        <Button type="submit" size="lg" disabled={pending} className="mt-2 w-full">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-secondary">
        Already have an account?{" "}
        <a href="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
          Sign in
        </a>
      </p>
    </div>
  );
}
