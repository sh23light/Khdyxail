import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { DEFAULT_TEMPLATES, PromptTemplate } from "@/hooks/usePromptTemplates";
import { apiUrl } from "@/lib/apiBase";
import {
  X, ShieldAlert, Download, Printer, CheckCircle2,
  AlertCircle, Loader2, FileText, AlertTriangle
} from "lucide-react";

interface ScanResult {
  template: PromptTemplate;
  status: "pending" | "running" | "done" | "error";
  data: Record<string, unknown> | null;
  error: string | null;
}

const SECURITY_TEMPLATES = DEFAULT_TEMPLATES.filter((t) => t.group === "security");

function riskColor(sentiment: string | undefined) {
  if (sentiment === "negative") return { bg: "#fef2f2", border: "#fca5a5", text: "#b91c1c", label: "HIGH RISK" };
  if (sentiment === "mixed") return { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", label: "MEDIUM RISK" };
  return { bg: "#f0fdf4", border: "#86efac", text: "#166534", label: "LOW RISK" };
}

function generateHtmlReport(
  results: ScanResult[],
  generatedAt: Date,
): string {
  const done = results.filter((r) => r.status === "done" && r.data);
  const allActions: string[] = done.flatMap((r) =>
    Array.isArray(r.data?.actionItems) ? (r.data!.actionItems as string[]) : []
  );
  const allUrgent: { subject: string; from: string; reason: string; source: string }[] = done.flatMap((r) =>
    (Array.isArray(r.data?.urgentMessages)
      ? (r.data!.urgentMessages as { subject: string; from: string; reason: string }[])
      : []
    ).map((m) => ({ ...m, source: r.template.name }))
  );

  const sections = done.map((r) => {
    const c = riskColor(r.data?.sentiment as string | undefined);
    const urgent = Array.isArray(r.data?.urgentMessages)
      ? (r.data!.urgentMessages as { subject: string; from: string; reason: string }[])
      : [];
    const actions = Array.isArray(r.data?.actionItems) ? (r.data!.actionItems as string[]) : [];
    const cats = Array.isArray(r.data?.categories)
      ? (r.data!.categories as { name: string; count: number; description: string }[])
      : [];

    return `
      <div class="section" style="border-color:${c.border};background:${c.bg}">
        <div class="section-header">
          <span class="icon">${r.template.icon}</span>
          <div>
            <h2>${r.template.name}</h2>
            <p class="desc">${r.template.description}</p>
          </div>
          <span class="risk-badge" style="background:${c.border};color:${c.text}">${c.label}</span>
        </div>
        <p class="summary">${(r.data?.overallSummary as string) ?? ""}</p>
        ${r.data?.recommendation ? `<div class="rec"><strong>Recommendation:</strong> ${r.data.recommendation}</div>` : ""}
        ${urgent.length ? `
          <h3>⚠️ High-Risk Findings (${urgent.length})</h3>
          <ul class="findings">${urgent.map((u) => `
            <li><strong>${u.subject || "Untitled"}</strong> — ${u.from || "Unknown sender"}<br><span class="reason">${u.reason}</span></li>
          `).join("")}</ul>
        ` : ""}
        ${actions.length ? `
          <h3>✅ Hardening Actions</h3>
          <ul class="actions">${actions.map((a) => `<li>${a}</li>`).join("")}</ul>
        ` : ""}
        ${cats.length ? `
          <div class="cats">${cats.map((cat) => `
            <span class="cat-badge">${cat.name} <strong>${cat.count}</strong></span>
          `).join("")}</div>
        ` : ""}
      </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mailbox Security Threat Assessment — ${generatedAt.toLocaleDateString()}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; color: #1a1a1a; background: #f5f5f5; }
    .page { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
    .header { background: #111827; color: white; border-radius: 12px; padding: 28px 32px; margin-bottom: 24px; }
    .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .header .meta { color: #9ca3af; font-size: 12px; }
    .header .shield { font-size: 32px; margin-bottom: 12px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .stat { background: white; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; text-align: center; }
    .stat .num { font-size: 28px; font-weight: 700; color: #111827; }
    .stat .lbl { font-size: 11px; color: #6b7280; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat.red .num { color: #dc2626; }
    .stat.yellow .num { color: #d97706; }
    .section { border: 1.5px solid; border-radius: 10px; padding: 20px 22px; margin-bottom: 16px; }
    .section-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .icon { font-size: 24px; line-height: 1; }
    .section-header h2 { font-size: 15px; font-weight: 700; }
    .desc { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .risk-badge { margin-left: auto; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; white-space: nowrap; }
    .summary { color: #374151; line-height: 1.6; margin-bottom: 12px; }
    .rec { background: rgba(0,0,0,0.04); border-radius: 6px; padding: 10px 12px; font-size: 12px; margin-bottom: 12px; line-height: 1.5; }
    h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #4b5563; margin: 14px 0 8px; }
    .findings { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .findings li { background: rgba(220,38,38,0.05); border: 1px solid rgba(220,38,38,0.15); border-radius: 6px; padding: 8px 10px; line-height: 1.5; }
    .reason { color: #dc2626; font-size: 11px; }
    .actions { list-style: disc; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
    .actions li { line-height: 1.5; }
    .cats { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .cat-badge { background: rgba(0,0,0,0.06); border-radius: 4px; padding: 3px 8px; font-size: 11px; color: #374151; }
    .consolidated { background: white; border: 2px solid #111827; border-radius: 10px; padding: 20px 22px; margin-bottom: 24px; }
    .consolidated h2 { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
    .urgent-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .urgent-table th { text-align: left; padding: 6px 8px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .urgent-table td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    .footer { text-align: center; color: #9ca3af; font-size: 11px; margin-top: 32px; }
    @media print { body { background: white; } .page { padding: 0; } .header { border-radius: 0; } }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="shield">🛡️</div>
    <h1>Mailbox Security Threat Assessment</h1>
    <div class="meta">Generated ${generatedAt.toLocaleString()} · ${done.length}/${SECURITY_TEMPLATES.length} scans completed · Outlook Webmail Defender</div>
  </div>

  <div class="stats">
    <div class="stat red"><div class="num">${allUrgent.length}</div><div class="lbl">High-Risk Findings</div></div>
    <div class="stat yellow"><div class="num">${allActions.length}</div><div class="lbl">Action Items</div></div>
    <div class="stat"><div class="num">${done.length}</div><div class="lbl">Scans Run</div></div>
    <div class="stat"><div class="num">${results.filter((r) => r.status === "error").length}</div><div class="lbl">Scan Errors</div></div>
  </div>

  ${allUrgent.length ? `
  <div class="consolidated">
    <h2>🚨 All High-Risk Findings (${allUrgent.length})</h2>
    <table class="urgent-table">
      <thead><tr><th>Subject</th><th>From</th><th>Risk</th><th>Source Scan</th></tr></thead>
      <tbody>${allUrgent.map((u) => `
        <tr>
          <td>${u.subject || "—"}</td>
          <td>${u.from || "—"}</td>
          <td style="color:#dc2626">${u.reason}</td>
          <td style="color:#6b7280">${u.source}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  ` : ""}

  ${sections}

  ${allActions.length ? `
  <div class="consolidated">
    <h2>✅ All Hardening Actions (${allActions.length})</h2>
    <ol style="padding-left:18px;display:flex;flex-direction:column;gap:6px;">
      ${allActions.map((a) => `<li style="line-height:1.5">${a}</li>`).join("")}
    </ol>
  </div>
  ` : ""}

  <div class="footer">
    This report was generated by Outlook Webmail Defender using AI analysis of mailbox metadata.<br>
    Results are indicative — validate all findings before taking action. Not a substitute for professional security assessment.
  </div>
</div>
</body>
</html>`;
}

interface SecurityReportModalProps {
  onClose: () => void;
  systemPromptOverride?: string;
}

export default function SecurityReportModal({ onClose, systemPromptOverride }: SecurityReportModalProps) {
  const [results, setResults] = useState<ScanResult[]>(
    SECURITY_TEMPLATES.map((t) => ({ template: t, status: "pending", data: null, error: null }))
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const runScans = useCallback(async () => {
    setRunning(true);
    setDone(false);
    setReportHtml(null);
    const started = new Date();
    setGeneratedAt(started);

    const fresh: ScanResult[] = SECURITY_TEMPLATES.map((t) => ({
      template: t, status: "pending", data: null, error: null,
    }));
    setResults(fresh);

    const updated = [...fresh];

    for (let i = 0; i < SECURITY_TEMPLATES.length; i++) {
      const t = SECURITY_TEMPLATES[i];
      updated[i] = { ...updated[i], status: "running" };
      setResults([...updated]);

      try {
        const resp = await fetch(apiUrl("/api/email/analysis/mailbox"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ systemPrompt: systemPromptOverride ?? t.prompt }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `HTTP ${resp.status}`);
        }
        const data = await resp.json() as Record<string, unknown>;
        updated[i] = { ...updated[i], status: "done", data };
      } catch (err) {
        updated[i] = {
          ...updated[i],
          status: "error",
          error: err instanceof Error ? err.message : "Scan failed",
        };
      }
      setResults([...updated]);
    }

    setReportHtml(generateHtmlReport(updated, started));
    setRunning(false);
    setDone(true);
  }, [systemPromptOverride]);

  const downloadReport = () => {
    if (!reportHtml) return;
    const blob = new Blob([reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `security-report-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    if (!reportHtml) return;
    const win = window.open("", "_blank");
    if (win) { win.document.write(reportHtml); win.document.close(); win.print(); }
  };

  const completedCount = results.filter((r) => r.status === "done").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const urgentTotal = results
    .filter((r) => r.status === "done" && Array.isArray(r.data?.urgentMessages))
    .reduce((sum, r) => sum + (r.data!.urgentMessages as unknown[]).length, 0);
  const progressPct = ((completedCount + errorCount) / SECURITY_TEMPLATES.length) * 100;

  const statusIcon = (r: ScanResult) => {
    if (r.status === "pending") return <div className="w-4 h-4 rounded-full border-2 border-muted shrink-0" />;
    if (r.status === "running") return <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0" />;
    if (r.status === "done") return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
    return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Security Threat Assessment Report</h2>
            <p className="text-[11px] text-muted-foreground">Runs all 8 Security Defender scans and compiles a downloadable report</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Stats row (only when running or done) */}
          {(running || done) && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-foreground">{completedCount}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Scans Done</div>
              </div>
              <div className="bg-red-50 dark:bg-red-950/20 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-red-600">{urgentTotal}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Findings</div>
              </div>
              <div className="bg-muted/50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-foreground">{errorCount}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Errors</div>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {running && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Running scans…</span>
                <span>{completedCount + errorCount}/{SECURITY_TEMPLATES.length}</span>
              </div>
              <Progress value={progressPct} className="h-1.5" />
            </div>
          )}

          {/* Scan list */}
          <div className="space-y-2">
            {results.map((r) => {
              const urgentCount = Array.isArray(r.data?.urgentMessages)
                ? (r.data!.urgentMessages as unknown[]).length : 0;
              const actionCount = Array.isArray(r.data?.actionItems)
                ? (r.data!.actionItems as unknown[]).length : 0;

              return (
                <div
                  key={r.template.id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                    r.status === "running" && "border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/10",
                    r.status === "done" && "border-green-200/60 bg-green-50/30 dark:bg-green-950/10",
                    r.status === "error" && "border-destructive/20 bg-destructive/5",
                    r.status === "pending" && "border-border bg-muted/20 opacity-50",
                  )}
                >
                  <span className="text-base leading-none mt-0.5 shrink-0">{r.template.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{r.template.name}</span>
                      {r.status === "done" && urgentCount > 0 && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 leading-none">
                          {urgentCount} {urgentCount === 1 ? "finding" : "findings"}
                        </span>
                      )}
                      {r.status === "done" && urgentCount === 0 && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 leading-none">
                          Clear
                        </span>
                      )}
                    </div>
                    {r.status === "running" && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">Scanning…</p>
                    )}
                    {r.status === "done" && typeof r.data?.overallSummary === "string" && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {r.data.overallSummary as string}
                      </p>
                    )}
                    {r.status === "done" && actionCount > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {actionCount} hardening {actionCount === 1 ? "action" : "actions"} recommended
                      </p>
                    )}
                    {r.status === "error" && (
                      <p className="text-[11px] text-destructive mt-0.5">{r.error}</p>
                    )}
                    {r.status === "pending" && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{r.template.description}</p>
                    )}
                  </div>
                  {statusIcon(r)}
                </div>
              );
            })}
          </div>

          {/* Complete state */}
          {done && reportHtml && (
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-green-600" />
                <span className="text-sm font-semibold text-green-800 dark:text-green-300">Report ready</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Generated at {generatedAt?.toLocaleString()}. The HTML report is self-contained — open it in any browser.
                Use <strong>Print → Save as PDF</strong> to get a PDF version.
              </p>
              <div className="flex gap-2">
                <Button onClick={downloadReport} className="gap-1.5 text-xs h-8 flex-1">
                  <Download className="w-3.5 h-3.5" />
                  Download HTML Report
                </Button>
                <Button variant="outline" onClick={printReport} className="gap-1.5 text-xs h-8">
                  <Printer className="w-3.5 h-3.5" />
                  Print / PDF
                </Button>
              </div>
            </div>
          )}

          {/* Warning */}
          {!running && !done && (
            <div className="bg-amber-50/60 dark:bg-amber-950/10 border border-amber-200/60 rounded-xl p-4 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1">
                <p><strong className="text-foreground">This will make 8 API calls</strong> — one per Security Defender template — each fetching your 20 most recent inbox emails and sending them to OpenAI.</p>
                <p>Requires <code className="bg-muted px-1 rounded text-[10px]">OPENAI_API_KEY</code> to be set on the server. Results are illustrative; validate all findings before acting.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            Close
          </Button>
          <div className="flex gap-2">
            {done && (
              <Button variant="outline" size="sm" onClick={runScans} className="gap-1.5 text-xs">
                Re-run All Scans
              </Button>
            )}
            {!done && (
              <Button
                size="sm"
                onClick={runScans}
                disabled={running}
                className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="button-run-security-report"
              >
                {running ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
                ) : (
                  <><ShieldAlert className="w-3.5 h-3.5" /> Run All 8 Scans</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
