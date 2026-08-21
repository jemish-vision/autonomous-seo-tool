import { useState } from "react";
import { Globe, Monitor, Smartphone, AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  title: string | null;
  metaDescription: string | null;
  url: string;
}

// Approximate Google character pixel widths
const TITLE_MAX_PX = 580;
const DESC_MAX_PX = 960;

function estimatePixelWidth(text: string, isTitle: boolean): number {
  if (!text) return 0;
  // Approximate average character width for Arial 20px (title) vs Arial 14px (description)
  const avgCharWidth = isTitle ? 9.8 : 7.2;
  return Math.round(text.length * avgCharWidth);
}

export function SerpPreviewPanel({ title, metaDescription, url }: Props) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const displayTitle = title || "Untitled Document";
  const displayDesc = metaDescription || "No meta description provided for this page. Google will automatically extract a snippet from page content.";

  const titlePx = estimatePixelWidth(title ?? "", true);
  const descPx = estimatePixelWidth(metaDescription ?? "", false);

  const titleTruncated = titlePx > TITLE_MAX_PX;
  const descTruncated = descPx > DESC_MAX_PX;

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

  const hostname = parsedUrl ? parsedUrl.hostname : url;
  const pathParts = parsedUrl ? parsedUrl.pathname.split("/").filter(Boolean) : [];
  const breadcrumb = `${hostname}${pathParts.length > 0 ? " › " + pathParts.join(" › ") : ""}`;

  return (
    <Card id="serp-preview" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Google SERP Snippet Preview
          </h2>
        </div>

        <div className="flex items-center gap-1.5 rounded-control border border-border bg-subtle p-0.5">
          <Button
            size="sm"
            variant={device === "desktop" ? "primary" : "ghost"}
            onClick={() => setDevice("desktop")}
            className="h-7 px-2 text-xs gap-1.5"
          >
            <Monitor size={13} /> Desktop
          </Button>
          <Button
            size="sm"
            variant={device === "mobile" ? "primary" : "ghost"}
            onClick={() => setDevice("mobile")}
            className="h-7 px-2 text-xs gap-1.5"
          >
            <Smartphone size={13} /> Mobile
          </Button>
        </div>
      </div>

      {/* Google Search Result Mockup */}
      <div className="rounded-control border border-border bg-card p-4 shadow-sm">
        <div className={`space-y-1.5 ${device === "mobile" ? "max-w-sm" : "max-w-2xl"}`}>
          {/* Favicon & Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-[#4d5156] dark:text-[#bdc1c6] font-sans">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-subtle border border-border shrink-0">
              <Globe size={13} className="text-secondary" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] font-medium text-[#202124] dark:text-[#e8eaed] truncate">
                {hostname}
              </span>
              <span className="text-[11px] truncate text-[#4d5156] dark:text-[#bdc1c6]">
                {breadcrumb}
              </span>
            </div>
          </div>

          {/* Title Link */}
          <div className="pt-0.5">
            <h3
              className={`font-sans font-normal text-[#1a0dab] dark:text-[#8ab4f8] hover:underline cursor-pointer ${
                device === "mobile" ? "text-base leading-snug" : "text-xl leading-normal"
              }`}
            >
              {titleTruncated ? (
                <>
                  {displayTitle.slice(0, Math.floor(TITLE_MAX_PX / 9.8))}
                  <span className="font-bold text-foreground">...</span>
                </>
              ) : (
                displayTitle
              )}
            </h3>
          </div>

          {/* Meta Description */}
          <p className="font-sans text-[13px] leading-relaxed text-[#4d5156] dark:text-[#bdc1c6] pt-0.5">
            {descTruncated ? (
              <>
                {displayDesc.slice(0, Math.floor(DESC_MAX_PX / 7.2))}
                <span className="font-bold text-foreground">...</span>
              </>
            ) : (
              displayDesc
            )}
          </p>
        </div>
      </div>

      {/* Measurement Metrics & Truncation Checks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 text-xs">
        {/* Title Health */}
        <div className="rounded-control border border-border bg-subtle p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Title Tag Health</span>
            {title === null ? (
              <Badge tone="danger">Missing Title</Badge>
            ) : titleTruncated ? (
              <Badge tone="warn" className="gap-1">
                <AlertTriangle size={11} /> Truncated (~{titlePx}px / {TITLE_MAX_PX}px)
              </Badge>
            ) : (
              <Badge tone="ok" className="gap-1">
                <CheckCircle2 size={11} /> Optimal (~{titlePx}px / {TITLE_MAX_PX}px)
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between text-secondary">
            <span>Character Count:</span>
            <span className="font-mono font-medium text-foreground">
              {title?.length ?? 0} chars (Target: 50–60)
            </span>
          </div>
          {titleTruncated && (
            <p className="text-[11px] text-faint">
              ⚠️ Title exceeds ~580px and will likely be cut off with an ellipsis in Google search results.
            </p>
          )}
        </div>

        {/* Description Health */}
        <div className="rounded-control border border-border bg-subtle p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Meta Description Health</span>
            {metaDescription === null ? (
              <Badge tone="warn">Missing Description</Badge>
            ) : descTruncated ? (
              <Badge tone="warn" className="gap-1">
                <AlertTriangle size={11} /> Truncated (~{descPx}px / {DESC_MAX_PX}px)
              </Badge>
            ) : (
              <Badge tone="ok" className="gap-1">
                <CheckCircle2 size={11} /> Optimal (~{descPx}px / {DESC_MAX_PX}px)
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between text-secondary">
            <span>Character Count:</span>
            <span className="font-mono font-medium text-foreground">
              {metaDescription?.length ?? 0} chars (Target: 120–160)
            </span>
          </div>
          {descTruncated && (
            <p className="text-[11px] text-faint">
              ⚠️ Description exceeds ~960px and may be truncated on desktop search viewports.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
