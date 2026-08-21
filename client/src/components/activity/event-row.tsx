import { Link } from "react-router-dom";
import { eventKindMeta, statusTone } from "@/lib/events-view";
import { cn } from "@/lib/cn";

export interface ActivityEvent {
  seq: number;
  type: string;
  ts: string;
  synthetic: boolean;
  url: string | null;
  statusCode: number | null;
  message: string;
  [key: string]: unknown;
}

const TONE_TEXT: Record<string, string> = {
  neutral: "text-secondary",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-primary",
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Props {
  event: ActivityEvent;
  pageId: string | null;
  runId: string;
  style?: React.CSSProperties;
}

export function EventRow({ event, pageId, runId, style }: Props) {
  const meta = eventKindMeta(event.type);
  const tone = event.type === "request" ? statusTone(event.statusCode) : meta.tone;

  if (meta.lifecycle) {
    return (
      <div style={style} className="flex items-center gap-3 px-3 text-xs box-border border-b border-border/40 overflow-hidden">
        <div className="h-px flex-1 bg-border" aria-hidden="true" />
        <span className={cn("shrink-0 font-medium uppercase tracking-wide", TONE_TEXT[tone])}>{meta.label}</span>
        <span className="shrink-0 tabular-nums text-faint">{formatTime(event.ts)}</span>
        <div className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div style={style} className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 font-mono text-xs box-border border-b border-border/40 overflow-hidden">
      <span className="w-[58px] sm:w-[68px] shrink-0 tabular-nums text-faint text-[11px] sm:text-xs">{formatTime(event.ts)}</span>
      <span className={cn("w-[110px] sm:w-[168px] shrink-0 truncate font-sans font-medium text-[11px] sm:text-xs", TONE_TEXT[tone])}>{meta.label}</span>
      <span className="w-[38px] sm:w-[52px] shrink-0 tabular-nums">
        {event.statusCode !== null ? <span className={TONE_TEXT[statusTone(event.statusCode)]}>{event.statusCode}</span> : <span className="text-faint">—</span>}
      </span>
      <span className="min-w-0 flex-1 truncate text-secondary" title={event.url ?? undefined}>
        {event.url ? (
          pageId ? (
            <Link to={`/pages/${pageId}?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2 hover:opacity-80">
              {event.url}
            </Link>
          ) : (
            event.url
          )
        ) : (
          event.message
        )}
      </span>
      {event.synthetic && (
        <span className="shrink-0 rounded-pill bg-subtle px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-faint">synthetic</span>
      )}
    </div>
  );
}
