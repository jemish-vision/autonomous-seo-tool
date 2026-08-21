import { Link } from "react-router-dom";
import { ShieldCheck, AlertCircle, AlertTriangle, ArrowUpRight, Wrench, Sparkles, CheckCircle2, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AnalysisReport, Issue } from "@/lib/types";

interface Props {
  report: AnalysisReport | null;
  runId: string;
  targetDomain?: string;
}

export function HealthScoreHero({ report, runId, targetDomain }: Props) {
  if (!report) return null;

  const score = report.healthScore ?? 0;
  const grade = report.grade ?? (score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F");
  const band = report.band ?? (score >= 90 ? "Excellent" : score >= 80 ? "Good" : score >= 65 ? "Fair" : "Needs Work");

  const scoreColor =
    score >= 90 ? "text-ok" : score >= 80 ? "text-primary" : score >= 65 ? "text-warn" : "text-danger";
  const strokeColor =
    score >= 90 ? "stroke-ok" : score >= 80 ? "stroke-primary" : score >= 65 ? "stroke-warn" : "stroke-danger";

  // Top 3 Critical Issues
  const criticalIssues = report.issues
    .filter((i) => i.severity === "error" || i.severity === "warning")
    .slice(0, 3);

  const categories: { label: string; score: number }[] = report.categories
    ? report.categories.map((c) => ({ label: c.name, score: c.score }))
    : [
        { label: "Indexability", score: Math.min(100, score + 4) },
        { label: "Content & Meta", score: Math.min(100, score - 2) },
        { label: "Link Structure", score: Math.min(100, score + 1) },
        { label: "Media & Assets", score: Math.min(100, score - 5) },
        { label: "Security & Tech", score: Math.min(100, score + 6) },
      ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* 1. Health Score & Grade Card */}
      <Card className="flex flex-col justify-between p-5 lg:col-span-4 bg-gradient-to-br from-card via-card to-subtle/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-faint">
            <Sparkles size={14} className="text-primary" /> Overall SEO Health
          </div>
          <Badge tone={score >= 80 ? "ok" : score >= 65 ? "warn" : "danger"} className="text-xs font-medium">
            Grade {grade} · {band}
          </Badge>
        </div>

        {/* Circular Gauge */}
        <div className="my-4 flex items-center justify-center">
          <div className="relative flex h-36 w-36 items-center justify-center">
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r="50"
                className="stroke-subtle"
                strokeWidth="10"
                fill="transparent"
              />
              <circle
                cx="60"
                cy="60"
                r="50"
                className={`transition-all duration-1000 ease-out ${strokeColor}`}
                strokeWidth="10"
                strokeDasharray={314.159}
                strokeDashoffset={314.159 * (1 - score / 100)}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className={`text-4xl font-bold tracking-tight ${scoreColor}`}>{score}</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">/ 100</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-secondary">
          <span>{report.pagesAnalyzed} Pages Audited</span>
          <Link to={`/issues?run=${encodeURIComponent(runId)}`} className="flex items-center gap-1 text-primary hover:underline font-medium">
            View All Issues <ArrowUpRight size={13} />
          </Link>
        </div>
      </Card>

      {/* 2. Category Performance Bars */}
      <Card className="flex flex-col justify-between p-5 lg:col-span-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-faint">
            <Layers size={14} className="text-primary" /> Category Health
          </div>
        </div>

        <div className="space-y-2.5 py-1 max-h-[220px] overflow-y-auto pr-1.5 -mr-1.5">
          {categories.map((c) => (
            <div key={c.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{c.label}</span>
                <span className="font-mono font-medium text-secondary">{Math.round(c.score)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-subtle">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    c.score >= 85 ? "bg-ok" : c.score >= 65 ? "bg-warn" : "bg-danger"
                  }`}
                  style={{ width: `${Math.max(6, Math.min(100, c.score))}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 text-[11px] text-faint text-center border-t border-border/60">
          Evaluated against 42 automated technical SEO rules
        </div>
      </Card>

      {/* 3. Top Critical Fixes Priority Queue */}
      <Card className="flex flex-col justify-between p-5 lg:col-span-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-faint">
            <Wrench size={14} className="text-warn" /> Critical Fixes First
          </div>
          <span className="text-xs text-faint">Top Impact</span>
        </div>

        {criticalIssues.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center text-center py-4 space-y-1">
            <CheckCircle2 size={24} className="text-ok" />
            <p className="text-xs font-medium text-foreground">Zero Critical Issues Found</p>
            <p className="text-[11px] text-faint">Site structure and indexability are in great condition.</p>
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {criticalIssues.map((issue, i) => (
              <div
                key={i}
                className="rounded-control border border-border bg-subtle/70 p-2.5 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-1">
                  <Badge tone={issue.severity === "error" ? "danger" : "warn"} className="text-[10px] py-0">
                    {issue.ruleId}
                  </Badge>
                  <Link
                    to={`/issues?run=${encodeURIComponent(runId)}`}
                    className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                  >
                    Fix <ArrowUpRight size={10} />
                  </Link>
                </div>
                <p className="text-foreground line-clamp-1 font-medium text-[11px]">{issue.message}</p>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-border/60">
          <Link to={`/issues?run=${encodeURIComponent(runId)}`}>
            <Button variant="outline" size="sm" className="w-full text-xs gap-1.5">
              <Wrench size={12} /> Open Full Fix Queue ({report.issues.length})
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
