import { useEffect, useRef } from "react";
// import { StatValue } from "@/components/ui/stat-value"; // only used by the commented-out coverage dial below

/**
 * The login screen's branded half. Built from the app's own hex-matrix chart (Overview page,
 * components/charts/hex-matrix.tsx) rather than stock art or an invented motif — same hex
 * geometry, same status-class color mapping, so this reads as the same product rather than a
 * generic gradient. Decorative only (aria-hidden): it is not real run data, so it is never given
 * a role/label that would claim otherwise.
 *
 * Client component: the continuous "drift" effect (a lit hex hands its colour to an empty
 * neighbour, forever) is stateful — coordinating one cell's fade-out with its neighbour's
 * fade-in isn't something CSS alone can do. The starting field still renders once on the server,
 * so it stays a deterministic seeded render (a random start would be a hydration mismatch);
 * only the drift that begins after mount uses Math.random.
 */

type Tone = "2xx" | "3xx" | "4xx" | "5xx" | "blocked" | "empty";

const TONE_COLOR: Record<Tone, string> = {
  "2xx": "var(--data-blue)",
  "3xx": "var(--data-violet)",
  "4xx": "var(--data-orange)",
  "5xx": "var(--data-red)",
  blocked: "var(--text-faint)",
  empty: "var(--border)",
};

// Same hex geometry as hex-matrix.tsx (R=9 circumradius, flat-top offset grid) so the shape
// reads as literally the same chart family, not a lookalike.
// Dense enough that a hex reads as one page in a large crawl, not a decorative tile — at 13x15
// the slice scaled each hex to ~32px and the field lost its meaning.
const COLS = 30;
const ROWS = 40;
const R = 9;
const HORIZ = Math.sqrt(3) * R;
const VERT = 1.5 * R;
const WIDTH = COLS * HORIZ + HORIZ / 2 + R;
const HEIGHT = ROWS * VERT + 0.5 * VERT + R;

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// Deterministic hash keyed by grid position — never Math.random/Date.now: this renders on the
// server and again during hydration, and a non-deterministic value is a real hydration mismatch.
// Mixes row and col separately with an avalanche step; a plain LCG over the flat index banded
// into visible diagonal stripes once the grid got dense, which read as wallpaper, not data.
function seeded(row: number, col: number): number {
  let h = Math.imul(row + 1, 0x27d4eb2d) ^ Math.imul(col + 1, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function toneFor(row: number, col: number): Tone {
  const s = seeded(row, col);
  // Bottom rows fade toward "empty" so the lower third of the panel stays visually calm —
  // that's where the heading/caption sit.
  const fade = row / ROWS;
  if (s > 0.58 + fade * 0.34) return "empty";
  // Proportions track the legend below (92 / 5 / 3) — a field showing far more errors than the
  // legend claims reads as wrong even though it's decorative.
  if (s > 0.105) return "2xx";
  if (s > 0.055) return "3xx";
  if (s > 0.025) return "4xx";
  if (s > 0.01) return "blocked";
  return "5xx";
}

const CELLS = Array.from({ length: COLS * ROWS }, (_, i) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  const cx = col * HORIZ + (row % 2 === 1 ? HORIZ / 2 : 0) + R + 1;
  const cy = row * VERT + R + 1;
  return { key: i, row, col, cx, cy, tone: toneFor(row, col) };
});

// Flat-top offset grid, odd rows shifted right — the 6 axial neighbours of (row, col).
const NEIGHBOR_DELTAS = (odd: number): [number, number][] => [
  [0, -1],
  [0, 1],
  [-1, -1 + odd],
  [-1, odd],
  [1, -1 + odd],
  [1, odd],
];

// Precomputed once at module scope (grid geometry is static) so each drift tick just does array
// lookups rather than recomputing neighbours every 900ms.
const NEIGHBORS: number[][] = CELLS.map(({ row, col }) =>
  NEIGHBOR_DELTAS(row % 2)
    .map(([dr, dc]): [number, number] => [row + dr, col + dc])
    .filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS)
    .map(([r, c]) => r * COLS + c),
);

const LIT_OPACITY = 0.55;
const EMPTY_OPACITY = 0.3;
const TICK_MS = 900;
const HANDOFFS_PER_TICK = 10;

// const LEGEND: { tone: Tone; label: string; percent: number }[] = [
//   { tone: "2xx", label: "OK", percent: 92 },
//   { tone: "4xx", label: "Client error", percent: 5 },
//   { tone: "blocked", label: "Blocked", percent: 3 },
// ];

// Coverage dial: r=26, circumference = 2*pi*26 ~= 163.4. Dash offset renders 78%.
// const DIAL_R = 26;
// const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_R;
// const DIAL_PERCENT = 78;
// const DIAL_OFFSET = DIAL_CIRCUMFERENCE * (1 - DIAL_PERCENT / 100);

export function AuthVisual() {
  const toneRef = useRef<Tone[]>(CELLS.map((c) => c.tone));
  const litRef = useRef<Set<number>>(new Set(CELLS.filter((c) => c.tone !== "empty").map((c) => c.key)));
  const polyRefs = useRef<(SVGPolygonElement | null)[]>([]);

  // Drift: every tick, a handful of lit cells hand their colour to an empty neighbour. Colours
  // only move — nothing is created or destroyed — so the lit-cell count never changes.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // freeze on the static field, no timer at all

    const interval = setInterval(() => {
      const lit = litRef.current;
      const tones = toneRef.current;
      const usedThisTick = new Set<number>();
      const litArray = Array.from(lit);
      let handoffs = 0;
      let attempts = 0;
      const maxAttempts = HANDOFFS_PER_TICK * 6;

      while (handoffs < HANDOFFS_PER_TICK && attempts < maxAttempts && litArray.length > 0) {
        attempts++;
        const src = litArray[Math.floor(Math.random() * litArray.length)];
        if (usedThisTick.has(src)) continue;

        const candidates = NEIGHBORS[src].filter((n) => tones[n] === "empty" && !usedThisTick.has(n));
        if (candidates.length === 0) continue;

        const dst = candidates[Math.floor(Math.random() * candidates.length)];
        const tone = tones[src];

        tones[src] = "empty";
        tones[dst] = tone;
        lit.delete(src);
        lit.add(dst);
        usedThisTick.add(src);
        usedThisTick.add(dst);
        handoffs++;

        const srcEl = polyRefs.current[src];
        if (srcEl) {
          srcEl.style.fill = TONE_COLOR.empty;
          srcEl.style.opacity = String(EMPTY_OPACITY);
        }
        const dstEl = polyRefs.current[dst];
        if (dstEl) {
          dstEl.style.fill = TONE_COLOR[tone];
          dstEl.style.opacity = String(LIT_OPACITY);
        }
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-elevated">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        {CELLS.map(({ key, cx, cy, tone }) => (
          <polygon
            key={key}
            ref={(el) => {
              polyRefs.current[key] = el;
            }}
            className="auth-hex"
            points={hexPoints(cx, cy, R - 1)}
            style={{
              fill: TONE_COLOR[tone],
              opacity: tone === "empty" ? EMPTY_OPACITY : LIT_OPACITY,
            }}
          />
        ))}
      </svg>

      {/* Left-panel copy — commented out per owner review (drift prototype). The honeycomb field
          now fills the panel edge-to-edge with nothing on top of it. To restore: uncomment this
          block plus the LEGEND/DIAL_* consts and the StatValue import above. */}
      {/*
      <div aria-hidden="true" />
      <div className="auth-glass relative mx-5 mb-5 flex flex-col gap-6 rounded-panel px-8 py-7">
        <div className="max-w-[320px]">
          <h2 className="text-[28px] font-semibold leading-tight text-foreground">Every page. Every finding.</h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            A live map of crawl coverage, structure, and the issues worth fixing — the same chart
            you&rsquo;ll see on Overview once you&rsquo;re in.
          </p>
        </div>

        <div className="flex items-end justify-between gap-6 border-t border-border pt-5">
          <ul className="flex flex-col gap-1.5">
            {LEGEND.map((row) => (
              <li key={row.tone} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: TONE_COLOR[row.tone] }} aria-hidden="true" />
                <span className="text-secondary">{row.label}</span>
                <span className="rounded-pill bg-subtle px-1.5 py-0.5 tabular-nums text-secondary">{row.percent}%</span>
              </li>
            ))}
          </ul>

          <div className="flex shrink-0 items-center gap-3">
            <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="32" r={DIAL_R} fill="none" stroke="var(--border)" strokeWidth={5} />
              <circle
                cx="32"
                cy="32"
                r={DIAL_R}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray={DIAL_CIRCUMFERENCE}
                strokeDashoffset={DIAL_OFFSET}
                transform="rotate(-90 32 32)"
              />
            </svg>
            <StatValue value={`${DIAL_PERCENT}%`} caption="Crawl coverage" />
          </div>
        </div>
      </div>
      */}
    </div>
  );
}
