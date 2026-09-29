import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain, X, CheckSquare, MessageSquare, Tag, Zap,
  Save, Lock, ShieldCheck, ChevronDown, ChevronUp, Trash2, Bot
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiSystemPrompt } from "@/hooks/useAiSystemPrompt";
import { useAiProvider, PROVIDER_INFO } from "@/hooks/useAiProvider";
import { apiUrl } from "@/lib/apiBase";
import PromptTemplateLibrary from "@/components/email/PromptTemplateLibrary";
import AiProviderModal from "@/components/email/AiProviderModal";

interface AiAnalysisPanelProps {
  messageId: string;
  onClose: () => void;
}

export default function AiAnalysisPanel({ messageId, onClose }: AiAnalysisPanelProps) {
  const { prompt, setPrompt, clearPrompt, hasPrompt } = useAiSystemPrompt();
  const { config: aiConfig, hasConfig } = useAiProvider();
  const [draftPrompt, setDraftPrompt] = useState(prompt);
  const [promptExpanded, setPromptExpanded] = useState(!hasPrompt);
  const promptDirty = draftPrompt !== prompt;
  const [providerModalOpen, setProviderModalOpen] = useState(false);

  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savePrompt = () => {
    setPrompt(draftPrompt);
    setPromptExpanded(false);
  };

  const applyTemplate = (templatePrompt: string) => {
    setPrompt(templatePrompt);
    setDraftPrompt(templatePrompt);
    setPromptExpanded(false);
  };

  const handleAnalyze = async () => {
    if (!hasPrompt) return;
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch(apiUrl(`/api/email/messages/${messageId}/ai-analysis`), {
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
      const data = await resp.json() as Record<string, unknown>;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const sentimentColors: Record<string, string> = {
    positive: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    neutral: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    negative: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  const priorityColors: Record<string, string> = {
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  };
  const sentimentValue = result?.sentiment;
  const priorityValue = result?.priority;
  const summaryValue = result?.summary;
  const suggestedReplyValue = result?.suggestedReply;
  const sentiment = typeof sentimentValue === "string" ? sentimentValue : null;
  const priority = typeof priorityValue === "string" ? priorityValue : null;
  const summary = typeof summaryValue === "string" ? summaryValue : null;
  const suggestedReply = typeof suggestedReplyValue === "string" ? suggestedReplyValue : null;
  const actionItems = Array.isArray(result?.actionItems)
    ? result.actionItems.filter((item): item is string => typeof item === "string")
    : [];
  const keyTopics = Array.isArray(result?.keyTopics)
    ? result.keyTopics.filter((topic): topic is string => typeof topic === "string")
    : [];

  return (
    <div className="w-72 border-l border-border bg-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">AI Analysis</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setProviderModalOpen(true)}
            title={hasConfig ? `${PROVIDER_INFO[aiConfig!.provider].label} · ${aiConfig!.model}` : "Configure AI provider"}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
              hasConfig
                ? "text-primary bg-primary/10 hover:bg-primary/20"
                : "text-amber-600 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/40 animate-pulse"
            )}
          >
            <Bot className="w-3 h-3" />
            {hasConfig ? PROVIDER_INFO[aiConfig!.provider].label : "Set AI"}
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors ml-1"
            data-testid="button-close-ai"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* ── System Prompt section ── */}
        <div className={cn(
          "rounded-lg border transition-colors",
          hasPrompt ? "border-primary/20 bg-primary/5" : "border-dashed border-amber-300 bg-amber-50/50 dark:bg-amber-950/10"
        )}>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-left"
            onClick={() => setPromptExpanded((v) => !v)}
            data-testid="toggle-system-prompt-panel"
          >
            {hasPrompt
              ? <Lock className="w-3 h-3 text-primary shrink-0" />
              : <ShieldCheck className="w-3 h-3 text-amber-500 shrink-0" />
            }
            <span className="flex-1 text-[11px] font-medium truncate">
              {hasPrompt ? "System prompt set" : "System prompt required"}
            </span>
            {promptExpanded
              ? <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" />
              : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
            }
          </button>

          {promptExpanded && (
            <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                The AI follows <strong>only</strong> these instructions — no hidden defaults.
              </p>
              <Textarea
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                placeholder="e.g. Analyze this email and return JSON: { summary, sentiment, actionItems, priority }"
                className="min-h-[100px] text-[11px] font-mono resize-y leading-relaxed"
                data-testid="textarea-system-prompt-panel"
              />
              <div className="flex items-center gap-1.5 justify-end">
                {hasPrompt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px] text-destructive hover:text-destructive px-2"
                    onClick={() => { clearPrompt(); setDraftPrompt(""); }}
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-6 gap-1 text-[10px] px-2"
                  onClick={savePrompt}
                  disabled={!draftPrompt.trim()}
                  data-testid="button-save-prompt-panel"
                >
                  <Save className="w-3 h-3" />
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Template Library ── */}
        <div className="border-t border-border pt-3">
          <PromptTemplateLibrary activePrompt={prompt} onApply={applyTemplate} compact />
        </div>

        {/* ── Run / Loading / Results ── */}
        {!result && !loading && (
          <div className="text-center py-4 space-y-3">
            <Brain className="w-7 h-7 text-muted-foreground/25 mx-auto" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {hasPrompt
                ? "Run analysis on this email using your system prompt."
                : "Set a system prompt above first."}
            </p>
            <Button
              onClick={handleAnalyze}
              size="sm"
              className="w-full gap-1.5 text-xs"
              disabled={!hasPrompt}
              data-testid="button-run-analysis"
            >
              <Zap className="w-3.5 h-3.5" />
              Analyze Email
            </Button>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {result && !loading && (
          <div className="space-y-3 text-xs">
            {/* Badges */}
            {(sentiment || priority) && (
              <div className="flex gap-1.5 flex-wrap">
                {sentiment && (
                  <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium",
                    sentimentColors[sentiment] ?? sentimentColors.neutral
                  )}>
                    {sentiment}
                  </span>
                )}
                {priority && (
                  <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium",
                    priorityColors[priority] ?? priorityColors.medium
                  )}>
                    {priority} priority
                  </span>
                )}
              </div>
            )}

            {/* Summary */}
            {summary && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <Brain className="w-3 h-3" />
                  Summary
                </div>
                <p className="text-foreground/80 leading-relaxed">{summary}</p>
              </div>
            )}

            {/* Action items */}
            {actionItems.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  <CheckSquare className="w-3 h-3" />
                  Action Items
                </div>
                <ul className="space-y-1">
                  {actionItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-foreground/80">
                      <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Key topics */}
            {keyTopics.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  <Tag className="w-3 h-3" />
                  Key Topics
                </div>
                <div className="flex flex-wrap gap-1">
                  {keyTopics.map((topic, i) => (
                    <span key={i} className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded text-[10px]">
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested reply */}
            {suggestedReply && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <MessageSquare className="w-3 h-3" />
                  Suggested Reply
                </div>
                <div className="bg-muted rounded p-2 text-foreground/80 leading-relaxed italic text-[11px]">
                  {suggestedReply}
                </div>
              </div>
            )}

            {/* Catch-all: render any extra fields the prompt returned */}
            {Object.entries(result)
              .filter(([k]) => !["summary","sentiment","actionItems","keyTopics","suggestedReply","priority"].includes(k))
              .map(([key, val]) => (
                <div key={key}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </div>
                  <div className="text-foreground/80 leading-relaxed">
                    {Array.isArray(val)
                      ? (val as string[]).join(", ")
                      : String(val)}
                  </div>
                </div>
              ))
            }

            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs mt-1"
              onClick={handleAnalyze}
              data-testid="button-reanalyze"
            >
              <Zap className="w-3.5 h-3.5" />
              Re-analyze
            </Button>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        )}
      </div>
      <AiProviderModal open={providerModalOpen} onClose={() => setProviderModalOpen(false)} />
    </div>
  );
}
