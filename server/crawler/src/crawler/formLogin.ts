/**
 * Auth step 2 (C1) — drive a real browser through a login form, for sites where pasting a
 * session cookie isn't practical. See FormLoginConfig in models/types.ts (frozen contract).
 */
import type { BrowserContext, Cookie } from "playwright";
import type { FormLoginConfig } from "../models/types";

const NAV_TIMEOUT_MS = 15000;

export interface FormLoginResult {
  ok: boolean;
  cookies: Cookie[];
  error?: string;
}

/**
 * Runs one login attempt in a fresh page on the given context. Never throws — every failure mode
 * (bad selector, navigation timeout, wrong credentials) returns ok:false with a clear reason so
 * the caller can abort the crawl instead of silently proceeding anonymous.
 */
export async function performFormLogin(config: FormLoginConfig, context: BrowserContext): Promise<FormLoginResult> {
  const page = await context.newPage();
  try {
    await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.fill(config.usernameSelector, config.username, { timeout: NAV_TIMEOUT_MS });
    await page.fill(config.passwordSelector, config.password, { timeout: NAV_TIMEOUT_MS });

    // Start waiting for the post-click navigation before the click resolves — a submit handler
    // can navigate synchronously, so awaiting click() first would race the navigation event.
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => {}),
      page.click(config.submitSelector, { timeout: NAV_TIMEOUT_MS }),
    ]);

    if (config.successSelector) {
      const appeared = await page
        .waitForSelector(config.successSelector, { timeout: NAV_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!appeared) {
        return {
          ok: false,
          cookies: [],
          error: `login submitted but successSelector "${config.successSelector}" never appeared — credentials or selectors likely wrong`,
        };
      }
    }

    // No successSelector configured: fall back to "did the server actually set a cookie" — a
    // wrong-credentials submit that just re-renders the login page sets nothing.
    const cookies = await context.cookies();
    if (cookies.length === 0) {
      return {
        ok: false,
        cookies: [],
        error: "login form submitted but no session cookie was set — check credentials/selectors, or pass --login-success-selector",
      };
    }
    return { ok: true, cookies };
  } catch (err) {
    return { ok: false, cookies: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Serializes context cookies into one request Cookie header — the same shape CrawlAuth.cookie
 * already carries, so it rides authHeaders()'s existing Cookie-header path unchanged and reaches
 * both the CheerioCrawler pass (request headers) and the Playwright pass (setExtraHTTPHeaders).
 */
export function cookiesToHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
