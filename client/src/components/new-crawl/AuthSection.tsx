import { useRef, type KeyboardEvent } from "react";
import { AlertTriangle, Check, ChevronRight, Lock, Unlock, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { FormField } from "./FormField";

export type AuthMethod = "none" | "basic" | "cookie" | "header";

const METHOD_OPTIONS: { value: AuthMethod; title: string; description: string }[] = [
  { value: "none", title: "None", description: "Crawl anonymously" },
  { value: "basic", title: "Basic auth", description: "Username + password header" },
  { value: "cookie", title: "Cookie", description: "Paste a session cookie" },
  { value: "header", title: "Custom header", description: "API token or WAF bypass" },
];

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  method: AuthMethod;
  onMethodChange: (v: AuthMethod) => void;
  basicUsername: string;
  onBasicUsernameChange: (v: string) => void;
  basicUsernameError?: string | null;
  basicPassword: string;
  onBasicPasswordChange: (v: string) => void;
  basicPasswordError?: string | null;
  cookie: string;
  onCookieChange: (v: string) => void;
  cookieError?: string | null;
  headerName: string;
  onHeaderNameChange: (v: string) => void;
  headerNameError?: string | null;
  headerValue: string;
  onHeaderValueChange: (v: string) => void;
  headerValueError?: string | null;
  skipLogoutDestructive: boolean;
  onSkipLogoutDestructiveChange: (v: boolean) => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (v: boolean) => void;
  disabled?: boolean;
}

/**
 * Access section: collapsed-by-default login toggle -> auth method radio-cards (same visual
 * language as RenderModeCards) -> method-specific fields -> mandatory safety callout + a
 * skip-logout/destructive switch that starts locked ON (Sagar's requirement — disabling guard
 * rails on a live login must be a deliberate act, not a stray click).
 */
export function AuthSection({
  enabled,
  onEnabledChange,
  method,
  onMethodChange,
  basicUsername,
  onBasicUsernameChange,
  basicUsernameError,
  basicPassword,
  onBasicPasswordChange,
  basicPasswordError,
  cookie,
  onCookieChange,
  cookieError,
  headerName,
  onHeaderNameChange,
  headerNameError,
  headerValue,
  onHeaderValueChange,
  headerValueError,
  skipLogoutDestructive,
  onSkipLogoutDestructiveChange,
  advancedOpen,
  onAdvancedOpenChange,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <LoginToggle checked={enabled} onChange={onEnabledChange} disabled={disabled} />

      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-secondary">Authentication method</p>
            <AuthMethodCards value={method} onChange={onMethodChange} disabled={disabled} />
          </div>

          {method === "basic" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField htmlFor="auth-basic-username" label="Username" error={basicUsernameError}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-control border bg-canvas px-3 py-2 focus-within:ring-2 focus-within:ring-primary",
                    basicUsernameError ? "border-danger" : "border-border",
                  )}
                >
                  <User size={14} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
                  <input
                    id="auth-basic-username"
                    type="text"
                    autoComplete="off"
                    placeholder="readonly-qa"
                    value={basicUsername}
                    disabled={disabled}
                    aria-invalid={!!basicUsernameError}
                    onChange={(e) => onBasicUsernameChange(e.target.value)}
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
                  />
                </div>
              </FormField>
              <FormField htmlFor="auth-basic-password" label="Password" error={basicPasswordError}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-control border bg-canvas px-3 py-2 focus-within:ring-2 focus-within:ring-primary",
                    basicPasswordError ? "border-danger" : "border-border",
                  )}
                >
                  <Lock size={14} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
                  <input
                    id="auth-basic-password"
                    type="password"
                    autoComplete="off"
                    placeholder="••••••••"
                    value={basicPassword}
                    disabled={disabled}
                    aria-invalid={!!basicPasswordError}
                    onChange={(e) => onBasicPasswordChange(e.target.value)}
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint disabled:opacity-50"
                  />
                </div>
              </FormField>
            </div>
          )}

          {method === "cookie" && (
            <FormField
              htmlFor="auth-cookie"
              label="Cookie header"
              error={cookieError}
              hint="Log in to the site in your browser, open DevTools → Application → Cookies, copy the session cookie as name=value."
            >
              <textarea
                id="auth-cookie"
                rows={3}
                placeholder="session=eyJhbGciOi...; csrf=ab12cd34"
                value={cookie}
                disabled={disabled}
                aria-invalid={!!cookieError}
                onChange={(e) => onCookieChange(e.target.value)}
                className={cn(
                  "w-full resize-y rounded-control border bg-canvas px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-faint focus:ring-2 focus:ring-primary disabled:opacity-50",
                  cookieError ? "border-danger" : "border-border",
                )}
              />
            </FormField>
          )}

          {method === "header" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField htmlFor="auth-header-name" label="Header name" error={headerNameError}>
                <input
                  id="auth-header-name"
                  type="text"
                  placeholder="X-Api-Key"
                  value={headerName}
                  disabled={disabled}
                  aria-invalid={!!headerNameError}
                  onChange={(e) => onHeaderNameChange(e.target.value)}
                  className={cn(
                    "w-full rounded-control border bg-canvas px-3 py-2 text-sm text-foreground outline-none placeholder:text-faint focus:ring-2 focus:ring-primary disabled:opacity-50",
                    headerNameError ? "border-danger" : "border-border",
                  )}
                />
              </FormField>
              <FormField htmlFor="auth-header-value" label="Header value" error={headerValueError}>
                <input
                  id="auth-header-value"
                  type="password"
                  placeholder="••••••••"
                  value={headerValue}
                  disabled={disabled}
                  aria-invalid={!!headerValueError}
                  onChange={(e) => onHeaderValueChange(e.target.value)}
                  className={cn(
                    "w-full rounded-control border bg-canvas px-3 py-2 text-sm text-foreground outline-none placeholder:text-faint focus:ring-2 focus:ring-primary disabled:opacity-50",
                    headerValueError ? "border-danger" : "border-border",
                  )}
                />
              </FormField>
            </div>
          )}

          {method !== "none" && (
            <>
              <div className="flex items-start gap-2.5 rounded-control border border-warn/30 bg-warn-bg px-3 py-2.5 text-warn" role="alert">
                <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex flex-col gap-1 text-[11px] leading-snug">
                  <p className="text-xs font-semibold">This crawl runs as your logged-in user</p>
                  <p>
                    Use a read-only test account — never an admin login. Logout links and destructive-looking endpoints
                    (delete/remove/cancel) are skipped automatically so the crawler can&apos;t end its own session or
                    trigger an action.
                  </p>
                </div>
              </div>

              <SkipSafetyToggle
                checked={skipLogoutDestructive}
                onChange={onSkipLogoutDestructiveChange}
                advancedOpen={advancedOpen}
                onAdvancedOpenChange={onAdvancedOpenChange}
                disabled={disabled}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Same visual weight/structure as SettingSwitch — a designed switch row, never a raw checkbox. */
function LoginToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-control border border-border bg-card px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium text-foreground">This site needs a login</p>
        <p className={cn("text-[11px]", checked ? "text-primary" : "text-faint")} aria-live="polite">
          {checked ? "On — configure how the crawler authenticates below" : "Off — the crawler visits pages anonymously"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "rounded-pill border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            checked ? "border-primary/40 bg-primary/10 text-primary" : "border-border-strong bg-subtle text-faint",
          )}
        >
          {checked ? "On" : "Off"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="This site needs a login"
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative h-7 w-[52px] shrink-0 rounded-pill border-2 transition-colors duration-150 outline-none",
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            "disabled:pointer-events-none disabled:opacity-50",
            checked ? "border-primary bg-primary" : "border-border-strong bg-border-strong",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-card transition-transform duration-150",
              checked ? "translate-x-[24px]" : "translate-x-0.5",
            )}
          >
            {checked ? (
              <Lock size={12} strokeWidth={3} className="text-primary" aria-hidden="true" />
            ) : (
              <Unlock size={12} strokeWidth={3} className="text-secondary" aria-hidden="true" />
            )}
          </span>
        </button>
      </div>
    </div>
  );
}

/** Radio-card group — structurally identical to RenderModeCards (selected = filled ring + tinted bg + check badge). */
function AuthMethodCards({ value, onChange, disabled }: { value: AuthMethod; onChange: (v: AuthMethod) => void; disabled?: boolean }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % METHOD_OPTIONS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + METHOD_OPTIONS.length) % METHOD_OPTIONS.length;
    else return;
    e.preventDefault();
    onChange(METHOD_OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Authentication method" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {METHOD_OPTIONS.map((opt, i) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex flex-col gap-1 rounded-control border px-3 py-2.5 text-left transition-colors duration-150 outline-none",
              "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              "disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10 ring-2 ring-primary"
                : "border-border bg-card hover:border-border-strong hover:bg-subtle",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={cn("text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{opt.title}</span>
              {selected && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast">
                  <Check size={11} strokeWidth={3} aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="text-[11px] leading-snug text-secondary">{opt.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Locked ON by default (disabled while Advanced is closed) so disabling the guard rails always
 * takes a deliberate second action. The danger warning tracks `checked` alone — collapsing
 * Advanced again must never hide an already-disabled safety state from the operator.
 */
function SkipSafetyToggle({
  checked,
  onChange,
  advancedOpen,
  onAdvancedOpenChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-control border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-medium text-foreground">Skip logout &amp; destructive links</p>
          <p className="text-[11px] text-faint">Recommended — stops the crawler from logging itself out or triggering delete/cancel actions.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Skip logout & destructive links"
          disabled={disabled || !advancedOpen}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative h-7 w-[52px] shrink-0 rounded-pill border-2 transition-colors duration-150 outline-none",
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            "disabled:pointer-events-none disabled:opacity-50",
            checked ? "border-primary bg-primary" : "border-danger bg-danger",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-card transition-transform duration-150",
              checked ? "translate-x-[24px]" : "translate-x-0.5",
            )}
          >
            {checked ? (
              <Check size={12} strokeWidth={3} className="text-primary" aria-hidden="true" />
            ) : (
              <AlertTriangle size={12} strokeWidth={3} className="text-danger" aria-hidden="true" />
            )}
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
        disabled={disabled}
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={cn("shrink-0 transition-transform duration-150", advancedOpen && "rotate-90")}
          aria-hidden="true"
        />
        Advanced
      </button>

      {!checked && (
        <div className="mt-2 flex items-start gap-2 rounded-control border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
          <AlertTriangle size={14} strokeWidth={1.75} className="mt-[1px] shrink-0" aria-hidden="true" />
          <span>
            Logout and destructive links will be crawled. A logged-in crawl can end its own session or trigger delete/cancel
            actions. Only disable this on a read-only test account.
          </span>
        </div>
      )}
    </div>
  );
}
