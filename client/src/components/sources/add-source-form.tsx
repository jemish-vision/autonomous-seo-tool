import { useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/modal";
import { useCreateSource } from "@/api/sources";
import { usePairSource } from "@/api/tunnel";
import type { SourceKind } from "@/lib/types-sources";

const KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: "wordpress", label: "WordPress" },
  { value: "shopify", label: "Shopify" },
];

type FlowState = "form" | "pairing" | "waiting" | "success" | "error";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Connect-a-source modal. Two paths:
 *
 *   WordPress (default) — the pairing/tunnel flow. Enter a name + site URL, "Generate pairing code",
 *     then paste the returned ASC-XXXXXX code into the WordPress plugin (Settings → Autonomous SEO →
 *     Connect). No username/password needed; the pairing call already creates the source server-side
 *     (POST /api/tunnel/pair), so the Sources list refreshes immediately. A toggle underneath reveals
 *     the direct username + application-password path (POST /api/sources) for anyone who prefers it.
 *
 *   Shopify — the direct credentials flow (API key / secret / access token → POST /api/sources).
 *
 * Rendered inside <Modal>, opened by the "Connect source" button on the Sources page.
 */
export function AddSourceForm({ open, onClose }: Props) {
  const [kind, setKind] = useState<SourceKind>("wordpress");
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");

  // WordPress credentials (direct path)
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  // Shopify credentials
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");

  // WordPress: pairing (default) vs. direct username/password.
  const [useCredentials, setUseCredentials] = useState(false);

  // Pairing flow state.
  const [flowState, setFlowState] = useState<FlowState>("form");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createMut = useCreateSource();
  const pairMut = usePairSource();
  const [error, setError] = useState<string | null>(null);

  // WordPress uses the pairing flow unless the user opts into the direct credentials path.
  const isPairing = kind === "wordpress" && !useCredentials;

  const reset = () => {
    setKind("wordpress");
    setName("");
    setSiteUrl("");
    setUsername("");
    setAppPassword("");
    setApiKey("");
    setApiSecret("");
    setAccessToken("");
    setUseCredentials(false);
    setFlowState("form");
    setPairingCode("");
    setPairingError(null);
    setCopied(false);
    setError(null);
  };

  /** Close the modal and reset to a clean form for next time. */
  const close = () => {
    reset();
    onClose();
  };

  /** Direct credentials path (WordPress with username/password, or Shopify). */
  const handleCreateDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUrl = siteUrl.trim();
    let hostname = trimmedUrl;
    try {
      hostname = new URL(trimmedUrl).hostname;
    } catch {
      setError("Enter a valid site URL, e.g. https://example.com");
      return;
    }

    const credentials: Record<string, string> =
      kind === "wordpress"
        ? {
            ...(username.trim() ? { username: username.trim() } : {}),
            ...(appPassword.trim() ? { appPassword: appPassword.trim() } : {}),
          }
        : {
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            ...(apiSecret.trim() ? { apiSecret: apiSecret.trim() } : {}),
            ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
          };

    try {
      await createMut.mutateAsync({
        kind,
        name: name.trim() || hostname,
        siteUrl: trimmedUrl,
        credentials,
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create source");
    }
  };

  /** Pairing path (WordPress default): create a pending pairing and show the code. */
  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairingError(null);

    const trimmedUrl = siteUrl.trim();
    let hostname = trimmedUrl;
    try {
      hostname = new URL(trimmedUrl).hostname;
    } catch {
      setPairingError("Enter a valid site URL, e.g. https://example.com");
      setFlowState("error");
      return;
    }

    setFlowState("pairing");
    try {
      const data = await pairMut.mutateAsync({
        siteUrl: trimmedUrl,
        kind,
        name: name.trim() || hostname,
      });
      setPairingCode(data.code);
      setFlowState("waiting");
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : "Failed to create pairing code");
      setFlowState("error");
    }
  };

  /** Copy the pairing code to the clipboard. */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.getElementById("pairing-code-display");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };

  /** User pasted the code in WordPress — the source already exists from the pair call. */
  const handleDone = () => {
    setFlowState("success");
  };

  const inputClass =
    "w-full rounded-control border border-border bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  const labelClass = "block text-xs font-medium text-secondary mb-1";

  return (
    <Modal open={open} onClose={close} title="Connect a source" size="md" bodyClassName="p-5">
      <div className="space-y-4">
        {/* ── Pairing: success state ── */}
        {flowState === "success" && (
          <div className="rounded-control border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            <p className="font-medium">Pairing initiated</p>
            <p className="mt-1 text-xs">
              The site will appear as connected once the WordPress plugin completes pairing.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={reset}
                className="text-xs font-medium underline-offset-2 hover:underline"
              >
                Add another source
              </button>
              <button
                type="button"
                onClick={close}
                className="text-xs font-medium underline-offset-2 hover:underline"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* ── Pairing: waiting for the plugin ── */}
        {flowState === "waiting" && (
          <div className="space-y-4">
            <div className="rounded-control border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-medium text-primary">Paste this code in WordPress</p>
              <p className="mt-1 text-xs text-secondary">
                Go to <strong>Settings → Autonomous SEO → Connect</strong> in your WordPress admin and
                paste this code.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <code
                  id="pairing-code-display"
                  className="flex-1 select-all rounded-control border border-border bg-canvas px-3 py-2 font-mono text-lg font-bold tracking-wider text-foreground"
                >
                  {pairingCode}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-border bg-subtle text-secondary transition-colors hover:bg-elevated hover:text-foreground"
                  title="Copy to clipboard"
                  aria-label="Copy pairing code"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>

              <p className="mt-2 text-[11px] text-faint">
                Code expires in 1 hour. Once you paste it in WordPress, the plugin will connect
                automatically.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDone}
                className="flex-1 rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-contrast transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                I've paired it
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-control border border-border px-4 py-2 text-sm text-secondary hover:bg-subtle"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* ── Pairing: loading ── */}
        {flowState === "pairing" && (
          <div className="flex items-center gap-3 rounded-control border border-border bg-subtle p-4 text-sm text-secondary">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Creating pairing code…
          </div>
        )}

        {/* ── Pairing: error ── */}
        {flowState === "error" && (
          <div className="space-y-3">
            <div className="rounded-control bg-danger-bg px-3 py-2 text-xs text-danger">{pairingError}</div>
            <button
              type="button"
              onClick={() => {
                setFlowState("form");
                setPairingError(null);
              }}
              className="text-xs text-secondary hover:text-foreground"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Form state (shared across both paths) ── */}
        {flowState === "form" && (
          <>
            {error && <div className="rounded-control bg-danger-bg px-3 py-2 text-xs text-danger">{error}</div>}

            <form onSubmit={isPairing ? handlePair : handleCreateDirect} className="space-y-4">
              {/* Kind selector */}
              <div>
                <label htmlFor="source-kind" className={labelClass}>
                  Platform
                </label>
                <div className="relative">
                  <select
                    id="source-kind"
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as SourceKind);
                      setUseCredentials(false);
                      setError(null);
                    }}
                    className="w-full appearance-none rounded-control border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    {KIND_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint"
                    aria-hidden="true"
                  />
                </div>
              </div>

              {/* Name */}
              <div>
                <label htmlFor="source-name" className={labelClass}>
                  Display name
                </label>
                <input
                  id="source-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My WordPress Site"
                  className={inputClass}
                />
              </div>

              {/* Site URL */}
              <div>
                <label htmlFor="source-url" className={labelClass}>
                  Site URL
                </label>
                <input
                  id="source-url"
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                  className={inputClass}
                />
                {isPairing && (
                  <p className="mt-1 text-[11px] text-faint">
                    We'll generate a pairing code — no username or password needed.
                  </p>
                )}
              </div>

              {/* WordPress credentials (direct path only) */}
              {kind === "wordpress" && useCredentials && (
                <>
                  <div>
                    <label htmlFor="source-username" className={labelClass}>
                      WordPress username
                    </label>
                    <input
                      id="source-username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="admin"
                      autoComplete="off"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="source-app-password" className={labelClass}>
                      Application password
                    </label>
                    <input
                      id="source-app-password"
                      type="password"
                      value={appPassword}
                      onChange={(e) => setAppPassword(e.target.value)}
                      placeholder="xxxx xxxx xxxx xxxx"
                      autoComplete="off"
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-faint">
                      Create one under Users → Profile → Application Passwords in WordPress. Used for the
                      connection health check.
                    </p>
                  </div>
                </>
              )}

              {/* Shopify credentials */}
              {kind === "shopify" && (
                <>
                  <div>
                    <label htmlFor="source-api-key" className={labelClass}>
                      API key
                    </label>
                    <input
                      id="source-api-key"
                      type="text"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="source-api-secret" className={labelClass}>
                      API secret
                    </label>
                    <input
                      id="source-api-secret"
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      autoComplete="off"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="source-access-token" className={labelClass}>
                      Access token
                    </label>
                    <input
                      id="source-access-token"
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      autoComplete="off"
                      className={inputClass}
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={isPairing ? pairMut.isPending : createMut.isPending}
                className={cn(
                  "w-full rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-contrast transition-colors hover:bg-primary/90",
                  "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  (isPairing ? pairMut.isPending : createMut.isPending) && "opacity-50 cursor-not-allowed",
                )}
              >
                {isPairing
                  ? pairMut.isPending
                    ? "Generating…"
                    : "Generate pairing code"
                  : createMut.isPending
                    ? "Adding…"
                    : "Add source"}
              </button>
            </form>

            {/* WordPress: toggle between pairing and direct credentials. */}
            {kind === "wordpress" && (
              <button
                type="button"
                onClick={() => {
                  setUseCredentials((v) => !v);
                  setError(null);
                }}
                className="text-xs font-medium text-secondary underline-offset-2 hover:text-foreground hover:underline"
              >
                {useCredentials
                  ? "Connect with a pairing code instead"
                  : "Connect with username & password instead"}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
