export type RenderMode = "auto" | "never" | "always";
export type PanelState = "form" | "starting" | "running" | "done" | "failed" | "cancelled";

export interface CrawlStatusResponse {
  runId: string;
  state: "running" | "done" | "failed" | "cancelled";
  exitCode: number | null;
  log: string[];
  reportReady: boolean;
  note?: string;
}
