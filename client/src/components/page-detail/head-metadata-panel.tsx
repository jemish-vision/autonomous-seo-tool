import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ImageThumb } from "@/components/explorer/image-thumb";
import type { ExtendedCrawledPage } from "./types";
import { SectionCard, Empty, NotCaptured } from "./section-helpers";

function KeyValueList({ data, prefix }: { data: Record<string, string>; prefix: string }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <Empty>No {prefix} tags found.</Empty>;
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="truncate text-xs text-faint">{prefix}:{k}</dt>
          <dd className="truncate text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HeadMetadataPanel({ page }: { page: ExtendedCrawledPage }) {
  const headMeta = page.headMeta;

  if (headMeta === undefined) {
    return (
      <SectionCard id="head-metadata" title="Head metadata">
        <NotCaptured>Not captured in this run (re-crawl to capture Open Graph, Twitter card, and viewport signals).</NotCaptured>
      </SectionCard>
    );
  }

  const ogCount = Object.keys(headMeta.og).length;
  const twitterCount = Object.keys(headMeta.twitter).length;
  const verificationEntries = Object.entries(headMeta.verification);

  return (
    <SectionCard id="head-metadata" title="Head metadata" count={`${ogCount} og · ${twitterCount} twitter`}>
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Open Graph</h3>
          <KeyValueList data={headMeta.og} prefix="og" />
          {headMeta.ogImages.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {headMeta.ogImages.map((img, i) => (
                <div key={`${img.url}-${i}`} className="flex items-center gap-3 rounded-control border border-border bg-subtle p-2.5">
                  <ImageThumb src={img.url} alt={img.alt ?? ""} />
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate text-foreground">{img.url}</p>
                    <p className="mt-0.5 text-faint">
                      {img.width != null && img.height != null ? `${img.width}×${img.height}` : "dimensions not declared"}
                    </p>
                    <p className="truncate text-faint">alt: {img.alt || <span className="italic">missing</span>}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Twitter card</h3>
          <KeyValueList data={headMeta.twitter} prefix="twitter" />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Viewport &amp; rendering hints</h3>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-faint">Viewport</dt>
              <dd className="flex flex-wrap items-center gap-2 text-foreground">
                {headMeta.viewport ?? <span className="text-faint">— (not declared)</span>}
                {headMeta.viewportBlocksZoom && (
                  <Badge tone="danger" className="shrink-0">
                    <AlertTriangle size={10} strokeWidth={2} className="mr-1 inline" aria-hidden="true" />
                    WCAG 1.4.4 failure — blocks pinch-to-zoom
                  </Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Theme color</dt>
              <dd className="flex items-center gap-2 text-foreground">
                {headMeta.themeColor ? (
                  <>
                    <span className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: headMeta.themeColor }} aria-hidden="true" />
                    {headMeta.themeColor}
                  </>
                ) : (
                  <span className="text-faint">— (none)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Color scheme</dt>
              <dd className="text-foreground">{headMeta.colorScheme ?? <span className="text-faint">— (none)</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Referrer policy</dt>
              <dd className="text-foreground">{headMeta.referrer ?? <span className="text-faint">— (none)</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Generator</dt>
              <dd className="text-foreground">{headMeta.generator ?? <span className="text-faint">— (none)</span>}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-secondary">Verification tokens</h3>
          {verificationEntries.length === 0 ? (
            <Empty>No verification tokens found.</Empty>
          ) : (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              {verificationEntries.map(([provider, token]) => (
                <div key={provider} className="min-w-0">
                  <dt className="text-xs text-faint">{provider}</dt>
                  <dd className="truncate font-mono text-xs text-foreground">{token}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
