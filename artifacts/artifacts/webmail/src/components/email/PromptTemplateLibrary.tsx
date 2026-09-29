import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePromptTemplates, PromptTemplate } from "@/hooks/usePromptTemplates";
import { Check, Pencil, RotateCcw, ChevronDown, ChevronUp, X, ShieldAlert } from "lucide-react";

interface PromptTemplateLibraryProps {
  activePrompt: string;
  onApply: (prompt: string) => void;
  compact?: boolean;
}

export default function PromptTemplateLibrary({
  activePrompt,
  onApply,
  compact = false,
}: PromptTemplateLibraryProps) {
  const { templates, updateTemplate, resetTemplate, isCustomized } = usePromptTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [expanded, setExpanded] = useState(!compact);

  const productivity = templates.filter((t) => t.group === "productivity");
  const security = templates.filter((t) => t.group === "security");

  const startEdit = (t: PromptTemplate) => {
    setEditingId(t.id);
    setDraftText(t.prompt);
  };

  const saveEdit = (id: string) => {
    if (draftText.trim()) updateTemplate(id, draftText.trim());
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const isActive = (t: PromptTemplate) => t.prompt === activePrompt;

  const renderCard = (t: PromptTemplate) => {
    const active = isActive(t);
    const editing = editingId === t.id;
    const customized = isCustomized(t.id);
    const isSecurity = t.group === "security";

    return (
      <div
        key={t.id}
        className={cn(
          "rounded-xl border transition-all",
          active
            ? isSecurity
              ? "border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20 ring-1 ring-amber-400/30"
              : "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
            : isSecurity
              ? "border-amber-200/60 dark:border-amber-800/40 bg-card hover:border-amber-300/80 dark:hover:border-amber-700/60"
              : "border-border bg-card hover:border-border/80",
          editing && (isSecurity ? "border-amber-400/50 ring-1 ring-amber-400/30" : "border-primary/50 ring-1 ring-primary/20")
        )}
      >
        {/* Card header */}
        <div className={cn("flex items-start gap-2.5 p-3", compact && "p-2.5")}>
          <span className={cn("text-lg leading-none shrink-0 mt-0.5", compact && "text-base")}>
            {t.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn("font-semibold text-foreground", compact ? "text-[11px]" : "text-xs")}>
                {t.name}
              </span>
              {active && (
                <span className={cn(
                  "text-[9px] font-medium px-1.5 py-0.5 rounded-full leading-none",
                  isSecurity
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-primary/10 text-primary"
                )}>
                  Active
                </span>
              )}
              {customized && !active && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground leading-none">
                  Edited
                </span>
              )}
            </div>
            {!editing && (
              <p className={cn("text-muted-foreground mt-0.5 line-clamp-1", compact ? "text-[10px]" : "text-[11px]")}>
                {t.description}
              </p>
            )}
          </div>
        </div>

        {/* Edit area */}
        {editing ? (
          <div className="px-3 pb-3 space-y-2">
            <Textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              className="text-[11px] font-mono resize-y leading-relaxed min-h-[180px]"
              autoFocus
              data-testid={`textarea-template-${t.id}`}
            />
            <div className="flex items-center gap-1.5 justify-between">
              <div className="flex gap-1">
                {customized && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px] px-2 text-muted-foreground"
                    onClick={() => { resetTemplate(t.id); setDraftText(""); cancelEdit(); }}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </Button>
                )}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={cancelEdit}>
                  <X className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  className="h-6 gap-1 text-[10px] px-2"
                  onClick={() => saveEdit(t.id)}
                  disabled={!draftText.trim()}
                >
                  <Check className="w-3 h-3" />
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Action row */
          <div className="flex items-center gap-1 px-3 pb-3">
            <Button
              size="sm"
              variant={active ? "secondary" : "outline"}
              className={cn(
                "flex-1 gap-1 font-medium",
                compact ? "h-6 text-[10px]" : "h-7 text-xs",
                active && isSecurity && "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300/50"
              )}
              onClick={() => onApply(t.prompt)}
              data-testid={`button-apply-template-${t.id}`}
            >
              {active ? <><Check className="w-3 h-3" /> Applied</> : "Apply"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "shrink-0 text-muted-foreground hover:text-foreground",
                compact ? "h-6 w-6 p-0" : "h-7 w-7 p-0"
              )}
              onClick={() => startEdit(t)}
              data-testid={`button-edit-template-${t.id}`}
              title="Edit prompt"
            >
              <Pencil className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  const content = (
    <div className="space-y-4">
      {/* Productivity group */}
      <div>
        {!compact && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-0.5">
            Productivity
          </p>
        )}
        <div className={cn(
          "grid gap-2",
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        )}>
          {productivity.map(renderCard)}
        </div>
      </div>

      {/* Security Defender group */}
      <div>
        <div className={cn(
          "flex items-center gap-2 mb-2 px-0.5",
          compact ? "mt-2" : ""
        )}>
          <ShieldAlert className={cn(
            "text-amber-500 shrink-0",
            compact ? "w-3 h-3" : "w-3.5 h-3.5"
          )} />
          <p className={cn(
            "font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500",
            compact ? "text-[9px]" : "text-[10px]"
          )}>
            Security Defender
          </p>
        </div>
        <div className={cn(
          "grid gap-2",
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        )}>
          {security.map(renderCard)}
        </div>
      </div>
    </div>
  );

  if (!compact) return content;

  return (
    <div>
      <button
        className="w-full flex items-center justify-between px-1 py-1.5 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Templates ({templates.length})
        </span>
        {expanded
          ? <ChevronUp className="w-3 h-3 text-muted-foreground" />
          : <ChevronDown className="w-3 h-3 text-muted-foreground" />
        }
      </button>
      {expanded && <div className="mt-1">{content}</div>}
    </div>
  );
}
