/** Slice S4 implements the real arg parsing + wiring. */
import { parseArgs } from "node:util";
import { applyCrawlDelay, fetchRobots } from "./discovery/robots";
import { DEFAULT_USER_AGENT } from "./discovery/http";
import { runCrawl, CrawlCancelledError } from "./crawler/crawl";
import { defaultSafety } from "./crawler/safety";
import { printSummary } from "./report/summary";
import { EventLog } from "./events/eventLog";
import { MIN_CONCURRENCY, MAX_CONCURRENCY } from "./queue/runner";
import type { CrawlAuth, CrawlOptions, CrawlSafety, FormLoginConfig, RobotsInfo } from "./models/types";
import { DEFAULT_SCREENSHOT_BUDGET } from "./artifacts/screenshotPolicy";
import { maybeSyncRunToPostgres } from "./storage/supabaseSync.js";

const HELP_TEXT = `
seo-crawler-poc — POC-1 CLI crawler for the Autonomous SEO Platform

Usage:
  npm run crawl -- <startUrl> [options]

Options:
  --max-pages N       Max pages to crawl (default: 200; 0 = no limit, crawl the whole site)
  --max-depth N       Max link-hops from the start URL (default: unlimited; 0 = start URL only)
  --seed URL          Extra explicit URL to crawl at depth 0, repeatable (robots gate does not
                         apply to it — it was directly asked for). With --max-depth 0 the crawl
                         fetches exactly these + the start URL.
  --concurrency N      Max concurrent requests (default: 5)
  --no-robots          Ignore robots.txt (evidence is still recorded; enforcement is skipped)
  --render MODE         auto | never | always (default: auto)
  --screenshots         Capture a thumb + full-page WebP screenshot per page (default: off).
                         Forces browser rendering for pages that would otherwise stay static —
                         a screenshot needs a browser. Never fails the crawl on capture errors.
                         BOUNDED by default: top-N pages by importance + every page with an
                         error, not literally every page (owner-approved: 27.5GB vs 0.6GB per
                         100k pages, 45x). Screenshots also try a best-effort upload to Supabase
                         Storage when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are configured;
                         local files are always written regardless.
  --screenshot-budget N Max non-error pages captured by importance rank when --screenshots is
                         on (default: 50). Error pages are never bounded by this.
  --out DIR            Output directory for run evidence (default: storage)
  --alias host[,host]  Extra hostnames treated as this site (e.g. staging-domain crawls)
  --rps N               Requests/sec cap (default: 10 for localhost/127.*, 2 otherwise)
  --user-agent UA       User-Agent sent on every request — pages, robots.txt, sitemaps, feeds and
                         asset probes alike (default: seo-crawler-poc/0.1 (+poc; respectful)).
                         Overriding it is your call; the crawler never rotates or spoofs one,
                         so a robots.txt rule naming us always matches every request we make.
  --ignore-crawl-delay  Ignore robots.txt Crawl-delay. Honoured by default: it caps --rps at
                         1/delay requests per second and can only ever slow the crawl down.
  --run-id ID           Run identifier (default: <hostname>-<yyyymmdd-hhmmss>)
  --check-external      HEAD-check up to 50 unique external link targets after the crawl
                         (rps <= 2, 10s timeout) -> external-links.json. Off by default.
  --no-image-sizes      Skip the post-crawl image sizing pass. On by default: one ranged GET per
                         unique image URL yields both the byte size and the real header
                         dimensions, rate-limited to --rps against the host just crawled.
  --image-size-cap N    Max unique image URLs to size (default: 100). Images past the cap record
                         the reason they have no size — a size is never guessed.
  --no-favicon-probe    Skip favicon probing. On by default and cached per icon URL (a handful of
                         requests per crawl); without it favicons.effective can only ever be null,
                         since last-declared-wins with 404 fall-through needs real HTTP statuses.
  --basic-auth user:pass  HTTP Basic auth credentials for protected routes
  --cookie "<header>"     Raw Cookie header value (e.g. "session=abc; csrf=xyz")
  --header "Name: Value"  Extra request header, repeatable (API tokens, WAF bypass tokens)
  --exclude a,b,c         Comma-separated path substrings to always skip
  --no-safety             Disable logout/destructive guard rails (UNSAFE on authenticated crawls)

  Auth step 2 — browser-driven form login (for sites a pasted cookie can't reach):
  --login-url URL              Login page URL (required to enable form login)
  --login-user USER            Username (required with --login-url)
  --login-pass PASS            Password (required with --login-url)
  --login-user-selector SEL    Username field selector (default: input[name=username])
  --login-pass-selector SEL    Password field selector (default: input[type=password])
  --login-submit-selector SEL  Submit button selector (default: button[type=submit])
  --login-success-selector SEL Optional selector that must appear post-login to confirm success

  -h, --help            Show this help

Exit codes:
  0  crawl completed, no failures
  2  crawl completed, one or more URLs failed
  1  fatal error (invalid arguments, crawl could not start)
`.trim();

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function defaultRunId(hostname: string): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `${hostname}-${stamp}`;
}

function parseStartUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    // allow "localhost:3105" style input without an explicit scheme
    return new URL(`http://${raw}`);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "max-pages": { type: "string" },
      "max-depth": { type: "string" },
      seed: { type: "string", multiple: true },
      concurrency: { type: "string" },
      "no-robots": { type: "boolean" },
      render: { type: "string" },
      screenshots: { type: "boolean" },
      "screenshot-budget": { type: "string" },
      out: { type: "string" },
      alias: { type: "string" },
      rps: { type: "string" },
      "user-agent": { type: "string" },
      "ignore-crawl-delay": { type: "boolean" },
      "run-id": { type: "string" },
      "check-external": { type: "boolean" },
      "no-image-sizes": { type: "boolean" },
      "image-size-cap": { type: "string" },
      "no-favicon-probe": { type: "boolean" },
      "basic-auth": { type: "string" },
      cookie: { type: "string" },
      header: { type: "string", multiple: true },
      exclude: { type: "string" },
      "no-safety": { type: "boolean" },
      "login-url": { type: "string" },
      "login-user": { type: "string" },
      "login-pass": { type: "string" },
      "login-user-selector": { type: "string" },
      "login-pass-selector": { type: "string" },
      "login-submit-selector": { type: "string" },
      "login-success-selector": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const rawStartUrl = positionals[0];
  if (!rawStartUrl) {
    console.error("Error: missing <startUrl>.\n");
    console.log(HELP_TEXT);
    process.exit(1);
  }

  let parsedStart: URL;
  try {
    parsedStart = parseStartUrl(rawStartUrl);
  } catch {
    console.error(`Error: could not parse start URL: ${rawStartUrl}`);
    process.exit(1);
    return;
  }

  const renderRaw = values.render ?? "auto";
  if (renderRaw !== "auto" && renderRaw !== "never" && renderRaw !== "always") {
    console.error(`Error: --render must be one of auto|never|always (got "${renderRaw}")`);
    process.exit(1);
  }
  const render = renderRaw as "auto" | "never" | "always";

  const maxPagesRaw = Number(values["max-pages"] ?? "200");
  const concurrencyRaw = Number(values.concurrency ?? "5");
  if (!Number.isFinite(maxPagesRaw) || maxPagesRaw < 0) {
    console.error(`Error: --max-pages must be 0 (no limit) or a positive number (got "${values["max-pages"]}")`);
    process.exit(1);
  }
  // 0 = crawl-all sentinel; internally a huge number so every budget comparison stays plain math.
  const maxPages = maxPagesRaw === 0 ? Number.MAX_SAFE_INTEGER : maxPagesRaw;
  if (!Number.isFinite(concurrencyRaw) || concurrencyRaw <= 0) {
    console.error(`Error: --concurrency must be a positive number (got "${values.concurrency}")`);
    process.exit(1);
  }
  // Same 1-8 ceiling the job queue enforces (queue/runner.ts) — a runaway value here can never
  // outrun what the queue path allows either. Politeness (Crawl-delay, below) is a separate,
  // independent cap that always wins regardless of this one.
  const concurrency = Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.round(concurrencyRaw)));
  if (concurrency !== concurrencyRaw) {
    console.log(`--concurrency clamped ${concurrencyRaw} -> ${concurrency} (range is ${MIN_CONCURRENCY}-${MAX_CONCURRENCY})`);
  }

  let maxDepth: number | null = null;
  if (values["max-depth"] !== undefined) {
    maxDepth = Number(values["max-depth"]);
    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
      console.error(`Error: --max-depth must be a non-negative integer (got "${values["max-depth"]}")`);
      process.exit(1);
    }
  }

  const isLocalSeed = parsedStart.hostname === "localhost" || /^127\./.test(parsedStart.hostname);
  let rps = Number(values.rps ?? (isLocalSeed ? "10" : "2"));
  if (!Number.isFinite(rps) || rps <= 0) {
    console.error(`Error: --rps must be a positive number (got "${values.rps}")`);
    process.exit(1);
  }

  const userAgent = (values["user-agent"] ?? DEFAULT_USER_AGENT).trim();
  if (userAgent.length === 0) {
    console.error("Error: --user-agent must not be empty.");
    process.exit(1);
  }
  if (userAgent !== DEFAULT_USER_AGENT) {
    console.warn(`NOTE: sending a custom User-Agent on every request: ${userAgent}`);
  }

  const respectRobots = !values["no-robots"];
  // Pre-fetch robots.txt purely to read Crawl-delay: the rps cap has to be decided before the
  // crawl starts. Kept and handed to runCrawl (via CrawlRuntime.preFetchedRobots) below so the
  // crawl's own robots fetch can reuse it instead of fetching robots.txt a second time per crawl —
  // that double-fetch was a real, verified defect (the same class of bug this crawler flags other
  // tools for in the audit). Left null when we didn't pre-fetch (--no-robots / --ignore-crawl-delay)
  // so runCrawl falls back to its own fetch exactly as before in those cases.
  let preFetchedRobots: RobotsInfo | null = null;
  if (respectRobots && values["ignore-crawl-delay"] !== true) {
    const probe = await fetchRobots(parsedStart.origin, userAgent);
    preFetchedRobots = probe;
    const limited = applyCrawlDelay(rps, probe.crawlDelay);
    if (limited < rps) {
      console.log(`robots.txt Crawl-delay: ${probe.crawlDelay}s -> rps capped ${rps} -> ${limited.toFixed(4)}`);
      if ((probe.crawlDelay ?? 0) > 10) {
        console.warn(
          `WARNING: a ${probe.crawlDelay}s Crawl-delay makes this crawl very slow. ` +
            "Use --ignore-crawl-delay to override (your call, and it is a rule the site published).",
        );
      }
      rps = limited;
    }
  }

  const imageProbeCap = Number(values["image-size-cap"] ?? "100");
  if (!Number.isInteger(imageProbeCap) || imageProbeCap < 0) {
    console.error(`Error: --image-size-cap must be a non-negative integer (got "${values["image-size-cap"]}")`);
    process.exit(1);
  }

  const screenshotBudget = Number(values["screenshot-budget"] ?? DEFAULT_SCREENSHOT_BUDGET);
  if (!Number.isInteger(screenshotBudget) || screenshotBudget < 0) {
    console.error(`Error: --screenshot-budget must be a non-negative integer (got "${values["screenshot-budget"]}")`);
    process.exit(1);
  }

  const hostAliases = values.alias
    ? values.alias.split(",").map((h) => h.trim()).filter(Boolean)
    : [];

  const runId = values["run-id"] ?? defaultRunId(parsedStart.hostname);

  let basic: { username: string; password: string } | null = null;
  if (values["basic-auth"] !== undefined) {
    const idx = values["basic-auth"].indexOf(":");
    if (idx === -1) {
      console.error(`Error: --basic-auth must be user:pass (got "${values["basic-auth"]}")`);
      process.exit(1);
    }
    basic = { username: values["basic-auth"].slice(0, idx), password: values["basic-auth"].slice(idx + 1) };
  }

  const customHeaders: Record<string, string> = {};
  for (const raw of values.header ?? []) {
    const idx = raw.indexOf(":");
    if (idx === -1) {
      console.error(`Error: --header must be "Name: Value" (got "${raw}")`);
      process.exit(1);
    }
    customHeaders[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }

  // Auth step 2 (C1): if ANY login-* flag is present, loginUrl + user + pass are all required —
  // a partially-specified form login is an operator mistake, not a silent skip.
  let formLogin: FormLoginConfig | null = null;
  if (values["login-url"] || values["login-user"] || values["login-pass"]) {
    if (!values["login-url"] || !values["login-user"] || !values["login-pass"]) {
      console.error("Error: --login-url, --login-user, and --login-pass must all be provided together for form login.");
      process.exit(1);
    }
    formLogin = {
      loginUrl: values["login-url"],
      username: values["login-user"],
      password: values["login-pass"],
      usernameSelector: values["login-user-selector"] ?? "input[name=username]",
      passwordSelector: values["login-pass-selector"] ?? "input[type=password]",
      submitSelector: values["login-submit-selector"] ?? "button[type=submit]",
      successSelector: values["login-success-selector"] ?? null,
    };
  }

  const cookie = values.cookie ?? null;
  const hasHeaderAuth = basic !== null || cookie !== null || Object.keys(customHeaders).length > 0;
  const auth: CrawlAuth | null = hasHeaderAuth || formLogin ? { basic, cookie, headers: customHeaders, formLogin } : null;

  const excludePatterns = values.exclude
    ? values.exclude.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  // defaultSafety() predates form login and only inspects basic/cookie/headers — form login is
  // authentication too, so OR its presence into the same asymmetric "strict when credentials are
  // present" default (see CrawlSafety doc comment in models/types.ts) without touching safety.ts.
  const baseSafety = defaultSafety(auth);
  const authenticated = baseSafety.denyLogout || formLogin !== null;
  let safety: CrawlSafety = { excludePatterns, denyLogout: authenticated, denyDestructive: authenticated };
  if (values["no-safety"]) {
    console.warn(
      "WARNING: --no-safety disables the logout/destructive guard rails. Unsafe on authenticated crawls " +
        "— the crawler may follow /logout or a destructive GET endpoint and disrupt its own session.",
    );
    safety = { ...safety, denyLogout: false, denyDestructive: false };
  }

  const options: CrawlOptions = {
    startUrl: parsedStart.toString(),
    maxPages,
    concurrency,
    respectRobots,
    render,
    screenshots: values.screenshots === true,
    outDir: values.out ?? "storage",
    runId,
    userAgent,
    maxRequestsPerSecond: rps,
    hostAliases,
    maxDepth,
    auth,
    safety,
    imageSizes: values["no-image-sizes"] !== true,
    imageProbeCap,
    faviconProbe: values["no-favicon-probe"] !== true,
  };

  const checkExternal = values["check-external"] === true;

  // Never print credentials — name the auth method only, never the value.
  const authLabel =
    formLogin !== null
      ? "form-login"
      : basic !== null
        ? "basic"
        : cookie !== null
          ? "cookie"
          : Object.keys(customHeaders).length > 0
            ? "headers"
            : "none";

  console.log(`Crawl started: ${options.startUrl}`);
  console.log(`  run-id: ${options.runId} | render: ${options.render} | screenshots: ${options.screenshots === true} | robots: ${options.respectRobots} | max-pages: ${options.maxPages === Number.MAX_SAFE_INTEGER ? "all" : options.maxPages} | max-depth: ${options.maxDepth ?? "unlimited"} | check-external: ${checkExternal} | image-sizes: ${options.imageSizes === true ? `on (cap ${imageProbeCap})` : "off"} | favicon-probe: ${options.faviconProbe === true} | auth: ${authLabel} | concurrency: ${options.concurrency}`);

  // Real cancellation, not a UI-only stop: Ctrl+C reaches Crawlee, the asset probes, and the
  // external-link pool via the same AbortSignal the job queue uses (see queue/queue.ts). The
  // event log is created here too so a CLI-driven run is replayable afterwards, same as a
  // queue-driven one — see events/eventLog.ts.
  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.log("\nReceived SIGINT — cancelling the crawl (in-flight requests may finish; no new ones will start)...");
    controller.abort();
  });
  const eventLog = new EventLog(options.outDir, options.runId);
  await eventLog.init();

  try {
    const summary = await runCrawl(options, checkExternal, {
      signal: controller.signal,
      eventLog,
      preFetchedRobots: preFetchedRobots ?? undefined,
      screenshotBudget,
      extraSeeds: values.seed ?? [],
    });
    printSummary(summary);

    // Additive dual-write, off by default. runStore has already flushed every page/report file
    // by this point (runCrawl awaits store.saveReport before returning) — flat JSON is untouched
    // either way, see supabaseSync.ts's own try/catch.
    if (process.env.POSTGRES_SYNC_ENABLED === "true") {
      await maybeSyncRunToPostgres(options.outDir, options.runId);
    }

    process.exit(summary.failed > 0 ? 2 : 0);
  } catch (err) {
    if (err instanceof CrawlCancelledError) {
      console.log(`Crawl cancelled: ${err.message}`);
      process.exit(130); // conventional exit code for SIGINT-terminated work
    }
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
