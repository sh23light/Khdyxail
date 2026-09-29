import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Brain, Zap, AlertCircle, Users, CheckSquare,
  Tag, MessageSquare, RefreshCw, Save, Trash2,
  ShieldCheck, ChevronDown, ChevronUp, Lock, ShieldAlert, Bot
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiSystemPrompt } from "@/hooks/useAiSystemPrompt";
import { useAiProvider, PROVIDER_INFO } from "@/hooks/useAiProvider";
import { apiUrl } from "@/lib/apiBase";
import PromptTemplateLibrary from "@/components/email/PromptTemplateLibrary";
import SecurityReportModal from "@/components/email/SecurityReportModal";
import AiProviderModal from "@/components/email/AiProviderModal";

interface MailboxAnalysis {
  overallSummary: string;
  unreadCount: number;
  urgentMessages: { subject: string; from: string; reason: string }[];
  topSenders: { email: string; name: string; count: number }[];
  actionItems: string[];
  categories: { name: string; count: number; description: string }[];
  sentiment: string;
  recommendation: string;
  analyzedCount: number;
}

const sentimentStyles: Record<string, { label: string; class: string }> = {
  positive: { label: "Positive", class: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  neutral: { label: "Neutral", class: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  negative: { label: "Needs Attention", class: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  mixed: { label: "Mixed", class: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

function Section({ icon: Icon, title, children }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function MailboxAiTab() {
  const { prompt, setPrompt, clearPrompt, hasPrompt } = useAiSystemPrompt();
  const { config: aiConfig, hasConfig } = useAiProvider();
  const [draftPrompt, setDraftPrompt] = useState(prompt);
  const [promptExpanded, setPromptExpanded] = useState(!hasPrompt);
  const [analysis, setAnalysis] = useState<MailboxAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecurityReport, setShowSecurityReport] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const promptDirty = draftPrompt !== prompt;

  const savePrompt = () => {
    setPrompt(draftPrompt);
    setPromptExpanded(false);
  };

  const applyTemplate = (templatePrompt: string) => {
    setPrompt(templatePrompt);
    setDraftPrompt(templatePrompt);
    setPromptExpanded(false);
  };

  const runAnalysis = async () => {
    if (!hasPrompt) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(apiUrl("/api/email/analysis/mailbox"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemPrompt: prompt,
          ...(aiConfig ? {
            provider: aiConfig.provider,
            model: aiConfig.model,
            apiKey: aiConfig.apiKey,
          } : {}),
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Request failed: ${resp.status}`);
      }
      const data = await resp.json() as MailboxAnalysis;
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">

        {/* ── AI Provider bar ── */}
        <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">AI Agent</span>
            {hasConfig && aiConfig && (
              <span className="text-xs text-muted-foreground">
                {PROVIDER_INFO[aiConfig.provider].label} · {aiConfig.model}
              </span>
            )}
            {!hasConfig && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                No provider configured
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-7 gap-1.5 text-xs",
              !hasConfig && "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700/40 dark:text-amber-400 dark:hover:bg-amber-950/20 animate-pulse"
            )}
            onClick={() => setProviderModalOpen(true)}
          >
            <Bot className="w-3.5 h-3.5" />
            {hasConfig ? "Change Agent" : "Select Agent"}
          </Button>
        </div>

        {/* ── System Prompt Editor ── */}
        <div className={cn(
          "rounded-xl border-2 transition-colors",
          hasPrompt ? "border-primary/30 bg-card" : "border-dashed border-amber-300 bg-amber-50/50 dark:bg-amber-950/10"
        )}>
          {/* Header row */}
          <button
            className="w-full flex items-center gap-3 px-5 py-3.5 text-left"
            onClick={() => setPromptExpanded((v) => !v)}
            data-testid="toggle-system-prompt"
          >
            <div className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
              hasPrompt ? "bg-primary/10" : "bg-amber-100 dark:bg-amber-900/30"
            )}>
              {hasPrompt
                ? <Lock className="w-3.5 h-3.5 text-primary" />
                : <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">System Prompt</span>
                {hasPrompt ? (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                    Active
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Required
                  </span>
                )}
              </div>
              {hasPrompt && !promptExpanded && (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate pr-8">
                  {prompt}
                </p>
              )}
              {!hasPrompt && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                  You must set a system prompt before analysis can run
                </p>
              )}
            </div>
            {promptExpanded
              ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            }
          </button>

          {/* Expanded editor */}
          {promptExpanded && (
            <div className="px-5 pb-5 space-y-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                This is the <strong>only</strong> instruction the AI receives. It will not add any default behavior beyond what you write here. Be explicit about what you want it to do and how it should format the response.
              </p>
              <Textarea
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                placeholder="Write your system prompt here. Example:&#10;&#10;You are an email triage assistant. Analyze the inbox and respond only with JSON: { overallSummary, urgentMessages, actionItems }. Be concise. Flag anything requiring a response within 24 hours as urgent."
                className="min-h-[160px] text-sm font-mono leading-relaxed resize-y"
                data-testid="textarea-system-prompt"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {hasPrompt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                      onClick={() => { clearPrompt(); setDraftPrompt(""); }}
                      data-testid="button-clear-prompt"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasPrompt && !promptDirty && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setPromptExpanded(false)}
                    >
                      Collapse
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={savePrompt}
                    disabled={!draftPrompt.trim()}
                    data-testid="button-save-prompt"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {promptDirty ? "Save Changes" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Template Library ── */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Prompt Templates
            </h3>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs border-amber-300/60 text-amber-700 hover:bg-amber-50 dark:border-amber-700/40 dark:text-amber-400 dark:hover:bg-amber-950/20"
              onClick={() => setShowSecurityReport(true)}
              data-testid="button-open-security-report"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Security Report
            </Button>
          </div>
          <PromptTemplateLibrary activePrompt={prompt} onApply={applyTemplate} />
        </div>

        {/* ── Run Analysis ── */}
        {!analysis && !loading && (
          <div className={cn(
            "bg-card border border-border rounded-xl px-6 py-8 flex flex-col items-center text-center gap-4",
            !hasPrompt && "opacity-60"
          )}>
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold mb-1">Ready to analyze your mailbox</h2>
              <p className="text-xs text-muted-foreground">
                {hasPrompt
                  ? "Your system prompt is set. The AI will analyze your 20 most recent inbox emails using only your instructions."
                  : "Set your system prompt above before running analysis."}
              </p>
            </div>
            {error && (
              <div className="w-full bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 text-xs text-destructive text-left">
                {error}
              </div>
            )}
            <Button
              onClick={runAnalysis}
              disabled={!hasPrompt}
              className="gap-2"
              data-testid="button-run-mailbox-analysis"
            >
              <Zap className="w-4 h-4" />
              Analyze My Mailbox
            </Button>
            <p className="text-[10px] text-muted-foreground">
              {hasConfig ? `Using ${PROVIDER_INFO[aiConfig!.provider].label} · ${aiConfig!.model}` : "Select an AI agent above first"}
            </p>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="bg-card border border-border rounded-xl p-8 space-y-4">
            <div className="flex items-center gap-3">
              <Brain className="w-5 h-5 text-primary animate-pulse" />
              <div>
                <p className="text-sm font-medium">Analyzing your mailbox…</p>
                <p className="text-xs text-muted-foreground">Reading your most recent emails</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {analysis && !loading && (
          <>
            {/* Results header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium",
                  sentimentStyles[analysis.sentiment]?.class ?? sentimentStyles.neutral.class
                )}>
                  {sentimentStyles[analysis.sentiment]?.label ?? analysis.sentiment}
                </span>
                <span className="text-xs text-muted-foreground">
                  Based on {analysis.analyzedCount} messages
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={runAnalysis}
                data-testid="button-refresh-analysis"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-analyze
              </Button>
            </div>

            {/* Summary + stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <Section icon={MessageSquare} title="Mailbox Summary">
                  <p className="text-sm text-foreground/80 leading-relaxed">{analysis.overallSummary}</p>
                  {analysis.recommendation && (
                    <div className="mt-3 bg-primary/5 border border-primary/10 rounded-lg px-3 py-2.5">
                      <p className="text-xs font-medium text-primary mb-0.5">Recommendation</p>
                      <p className="text-xs text-foreground/70">{analysis.recommendation}</p>
                    </div>
                  )}
                </Section>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-4">
                <div className="bg-card border border-border rounded-xl p-4 flex flex-col items-center justify-center text-center">
                  <div className="text-2xl font-bold text-primary">{analysis.unreadCount}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">Unread</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4 flex flex-col items-center justify-center text-center">
                  <div className="text-2xl font-bold text-amber-500">{analysis.urgentMessages.length}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">Urgent</div>
                </div>
              </div>
            </div>

            {analysis.urgentMessages.length > 0 && (
              <Section icon={AlertCircle} title="Urgent Messages">
                <div className="space-y-2">
                  {analysis.urgentMessages.map((msg, i) => (
                    <div key={i} className="flex items-start gap-3 bg-destructive/5 border border-destructive/10 rounded-lg px-3 py-2.5">
                      <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{msg.subject}</div>
                        <div className="text-[10px] text-muted-foreground">{msg.from}</div>
                        <div className="text-[10px] text-destructive/80 mt-0.5">{msg.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {analysis.actionItems.length > 0 && (
                <Section icon={CheckSquare} title="Action Items">
                  <ul className="space-y-2">
                    {analysis.actionItems.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                        <div className="w-4 h-4 rounded border border-border flex items-center justify-center shrink-0 mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-sm bg-muted-foreground/40" />
                        </div>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {analysis.topSenders.length > 0 && (
                <Section icon={Users} title="Top Senders">
                  <div className="space-y-2">
                    {analysis.topSenders.map((sender, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0",
                          ["bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500"][i % 4]
                        )}>
                          {(sender.name || sender.email)[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{sender.name || sender.email}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{sender.email}</div>
                        </div>
                        <div className="text-xs font-semibold text-muted-foreground shrink-0">{sender.count}</div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>

            {analysis.categories.length > 0 && (
              <Section icon={Tag} title="Email Categories">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {analysis.categories.map((cat, i) => (
                    <div key={i} className="bg-muted/60 rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{cat.name}</span>
                        <span className="text-[10px] font-semibold text-primary">{cat.count}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-snug">{cat.description}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>

      {showSecurityReport && (
        <SecurityReportModal onClose={() => setShowSecurityReport(false)} />
      )}
      <AiProviderModal open={providerModalOpen} onClose={() => setProviderModalOpen(false)} />
    </div>
  );
}
