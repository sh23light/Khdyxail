import { useState, useCallback, useEffect } from "react";
import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useToggleRuleEnabled,
  type MailRule,
  type CreateRulePayload,
} from "@/hooks/useRules";
import { useRuleRunner } from "@/hooks/useRuleRunner";
import { loadLog, clearLog, clearLogForRule, type LogEntry } from "@/lib/ruleLog";
import {
  loadWatches,
  setWatch,
  removeWatch,
  getWatch,
} from "@/lib/ruleSchedule";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, MoreVertical, Pencil, Trash2, Filter,
  FolderInput, MailOpen, Trash, AlertCircle, Loader2,
  ChevronRight, Play, CheckCircle2, XCircle,
  History, ChevronDown, ChevronUp, RefreshCw, Bell, BellOff, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const FOLDER_OPTIONS = [
  { id: "inbox",         label: "Inbox" },
  { id: "sentItems",     label: "Sent Items" },
  { id: "drafts",        label: "Drafts" },
  { id: "archive",       label: "Archive" },
  { id: "deletedItems",  label: "Deleted Items" },
  { id: "junkemail",     label: "Junk" },
];

function folderLabel(id: string | undefined | null) {
  return FOLDER_OPTIONS.find((f) => f.id === id)?.label ?? id ?? "—";
}

function summariseConditions(rule: MailRule): string {
  const parts: string[] = [];
  const c = rule.conditions;
  if (c.senderContains.length)
    parts.push(`sender contains "${c.senderContains.join('", "')}"`);
  if (c.fromAddresses.length) {
    const addrs = c.fromAddresses.map((a) => a.emailAddress.address);
    parts.push(`from ${addrs.join(", ")}`);
  }
  if (c.subjectContains.length)
    parts.push(`subject contains "${c.subjectContains.join('", "')}"`);
  if (c.bodyContains.length)
    parts.push(`body contains "${c.bodyContains.join('", "')}"`);
  return parts.length ? parts.join(" · ") : "No conditions";
}

function summariseActions(rule: MailRule): { label: string; icon: React.ReactNode }[] {
  const a = rule.actions;
  const items: { label: string; icon: React.ReactNode }[] = [];
  if (a.moveToFolder)
    items.push({ label: `Move to ${folderLabel(a.moveToFolder)}`, icon: <FolderInput className="w-3.5 h-3.5" /> });
  if (a.markAsRead)
    items.push({ label: "Mark as read", icon: <MailOpen className="w-3.5 h-3.5" /> });
  if (a.markImportance && a.markImportance !== "normal")
    items.push({ label: `${a.markImportance[0]!.toUpperCase()}${a.markImportance.slice(1)} importance`, icon: <AlertCircle className="w-3.5 h-3.5" /> });
  if (a.delete)
    items.push({ label: "Delete", icon: <Trash className="w-3.5 h-3.5" /> });
  return items;
}

// ── Rule Form ────────────────────────────────────────────────────────────────

interface FormState {
  displayName: string;
  senderContains: string;
  fromAddresses: string;
  subjectContains: string;
  bodyContains: string;
  actionMove: boolean;
  actionMoveFolder: string;
  actionMarkRead: boolean;
  actionDelete: boolean;
}

const EMPTY_FORM: FormState = {
  displayName: "",
  senderContains: "",
  fromAddresses: "",
  subjectContains: "",
  bodyContains: "",
  actionMove: false,
  actionMoveFolder: "archive",
  actionMarkRead: false,
  actionDelete: false,
};

function ruleToForm(rule: MailRule): FormState {
  const c = rule.conditions;
  const a = rule.actions;
  return {
    displayName: rule.displayName ?? "",
    senderContains: c.senderContains.join(", "),
    fromAddresses: c.fromAddresses
      .map((x) => x.emailAddress.address).join(", "),
    subjectContains: c.subjectContains.join(", "),
    bodyContains: c.bodyContains.join(", "),
    actionMove: !!a.moveToFolder,
    actionMoveFolder: a.moveToFolder ?? "archive",
    actionMarkRead: a.markAsRead,
    actionDelete: a.delete,
  };
}

function formToPayload(f: FormState): CreateRulePayload {
  const splitTrim = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const conditions: CreateRulePayload["conditions"] = {};
  if (f.senderContains.trim()) conditions.senderContains = splitTrim(f.senderContains);
  if (f.fromAddresses.trim())
    conditions.fromAddresses = splitTrim(f.fromAddresses).map((addr) => ({ emailAddress: { address: addr } }));
  if (f.subjectContains.trim()) conditions.subjectContains = splitTrim(f.subjectContains);
  if (f.bodyContains.trim()) conditions.bodyContains = splitTrim(f.bodyContains);
  const actions: CreateRulePayload["actions"] = {};
  if (f.actionMove) actions.moveToFolder = f.actionMoveFolder;
  if (f.actionMarkRead) actions.markAsRead = true;
  if (f.actionDelete) { actions.delete = true; actions.stopProcessingRules = true; }
  return {
    displayName: f.displayName.trim() || "Untitled Rule",
    isEnabled: true,
    conditions,
    actions,
  };
}

function RuleFormDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: MailRule | null }) {
  const { toast } = useToast();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const isPending = createRule.isPending || updateRule.isPending;
  const [form, setForm] = useState<FormState>(() => editing ? ruleToForm(editing) : EMPTY_FORM);
  const set = (key: keyof FormState, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const hasConditions = form.senderContains.trim() || form.fromAddresses.trim() || form.subjectContains.trim() || form.bodyContains.trim();
  const hasActions = form.actionMove || form.actionMarkRead || form.actionDelete;

  const handleSave = async () => {
    if (!hasConditions) { toast({ title: "Add at least one condition", variant: "destructive" }); return; }
    if (!hasActions) { toast({ title: "Add at least one action", variant: "destructive" }); return; }
    const payload = formToPayload(form);
    try {
      if (editing) { await updateRule.mutateAsync({ id: editing.id, payload }); toast({ title: "Rule updated" }); }
      else { await createRule.mutateAsync(payload); toast({ title: "Rule created" }); }
      onClose();
    } catch (err) {
      toast({ title: editing ? "Failed to update rule" : "Failed to create rule", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="w-4 h-4" />{editing ? "Edit Rule" : "New Rule"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Rule name</Label>
            <Input value={form.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="e.g. Move newsletters to archive" className="h-8 text-xs" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Conditions <span className="font-normal text-muted-foreground">(any match triggers the rule)</span></p>
            <div className="rounded-lg border border-border divide-y divide-border">
              {[
                { label: "Sender email contains", placeholder: "newsletter@, @example.com", hint: "Comma-separated values", key: "senderContains" as const },
                { label: "Sent from address", placeholder: "noreply@company.com", hint: "Exact addresses, comma-separated", key: "fromAddresses" as const },
                { label: "Subject contains", placeholder: "Unsubscribe, Weekly Digest", hint: "Comma-separated keywords", key: "subjectContains" as const },
                { label: "Body contains", placeholder: "Click here to unsubscribe", hint: "Comma-separated phrases", key: "bodyContains" as const },
              ].map(({ label, placeholder, hint, key }) => (
                <div key={key} className="px-3 py-2.5 space-y-1.5">
                  <p className="text-xs font-medium">{label}</p>
                  <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className="h-7 text-xs" />
                  <p className="text-[10px] text-muted-foreground">{hint}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Actions</p>
            <div className="rounded-lg border border-border divide-y divide-border">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Switch id="action-move" checked={form.actionMove} onCheckedChange={(v) => set("actionMove", v)} className="scale-75 origin-left" />
                <Label htmlFor="action-move" className="text-xs flex-1 cursor-pointer font-medium">Move to folder</Label>
                {form.actionMove && (
                  <select value={form.actionMoveFolder} onChange={(e) => set("actionMoveFolder", e.target.value)} className="text-xs border border-border rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                    {FOLDER_OPTIONS.filter((f) => f.id !== "inbox").map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Switch id="action-markread" checked={form.actionMarkRead} onCheckedChange={(v) => set("actionMarkRead", v)} className="scale-75 origin-left" />
                <Label htmlFor="action-markread" className="text-xs flex-1 cursor-pointer font-medium">Mark as read</Label>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Switch id="action-delete" checked={form.actionDelete} onCheckedChange={(v) => set("actionDelete", v)} className="scale-75 origin-left" />
                <Label htmlFor="action-delete" className="text-xs flex-1 cursor-pointer">
                  <span className="font-medium">Delete message</span>
                  <span className="block text-muted-foreground">Moves to Deleted Items</span>
                </Label>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending} className="text-xs h-8">Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isPending} className="text-xs h-8 gap-1.5">
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editing ? "Save changes" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rule Card ────────────────────────────────────────────────────────────────

function RuleCard({ rule, isRunning, isWatching, onEdit, onDelete, onRun, onWatchChange }: {
  rule: MailRule;
  isRunning: boolean;
  isWatching: boolean;
  onEdit: (rule: MailRule) => void;
  onDelete: (rule: MailRule) => void;
  onRun: (rule: MailRule) => void;
  onWatchChange: () => void;
}) {
  const toggleEnabled = useToggleRuleEnabled();
  const { toast } = useToast();

  const handleWatchToggle = () => {
    if (isWatching) {
      removeWatch(rule.id);
    } else {
      setWatch(rule.id, true);
    }
    onWatchChange();
  };

  const watch = getWatch(rule.id);
  const lastChecked = watch?.lastCheckedAt ? new Date(watch.lastCheckedAt) : null;

  return (
    <div className={cn("rounded-lg border bg-card transition-colors", rule.isEnabled ? "border-border" : "border-border/50 opacity-60")}>
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Enable/disable toggle */}
        <div className="pt-0.5">
          <Switch
            checked={rule.isEnabled}
            onCheckedChange={() => {
              toggleEnabled.mutate({ id: rule.id, isEnabled: !rule.isEnabled }, {
                onError: () => toast({ title: "Failed to toggle rule", variant: "destructive" }),
              });
            }}
            disabled={toggleEnabled.isPending || rule.isReadOnly}
            className="scale-75 origin-left"
          />
        </div>

        {/* Rule info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{rule.displayName}</span>
            {rule.isReadOnly && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Read-only</Badge>}
            {rule.hasError && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 gap-1"><AlertCircle className="w-2.5 h-2.5" />Error</Badge>}
            {!rule.isEnabled && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">Disabled</Badge>}
            {isWatching && rule.isEnabled && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0">
                <Bell className="w-2.5 h-2.5" />
                Watching
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{summariseConditions(rule)}</p>
          {summariseActions(rule).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {summariseActions(rule).map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {a.icon}{a.label}
                  {i < summariseActions(rule).length - 1 && <ChevronRight className="w-2.5 h-2.5 text-primary/50" />}
                </span>
              ))}
            </div>
          )}
          {isWatching && lastChecked && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              Last checked {formatDistanceToNow(lastChecked, { addSuffix: true })}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Watch toggle */}
          {!rule.isReadOnly && (
            <button
              onClick={handleWatchToggle}
              title={isWatching ? "Stop watching for new mail" : "Apply this rule automatically when new mail arrives"}
              className={cn(
                "flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium border transition-colors select-none",
                isWatching && rule.isEnabled
                  ? "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {isWatching ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
              {isWatching ? "Watching" : "Watch"}
            </button>
          )}

          {/* Run Now */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRun(rule)}
            disabled={isRunning || rule.isReadOnly}
            className="h-7 text-[11px] gap-1.5 px-2.5"
            title="Run this rule against your inbox now"
          >
            {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {isRunning ? "Running…" : "Run Now"}
          </Button>

          {!rule.isReadOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-xs min-w-[160px]">
                <DropdownMenuItem onClick={() => onEdit(rule)} className="gap-2">
                  <Pencil className="w-3.5 h-3.5" />Edit rule
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(rule)} className="gap-2 text-destructive focus:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />Delete rule
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}

// ── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-6">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <History className="w-5 h-5 text-muted-foreground/50" />
        </div>
        <div>
          <p className="text-sm font-medium">No runs yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">Click "Run Now" on any rule, or enable "Watch" to run automatically when new mail arrives.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-muted-foreground">{entries.length} run{entries.length !== 1 ? "s" : ""} recorded (last 200 kept)</p>
        <button onClick={onClear} className="text-[11px] text-muted-foreground hover:text-destructive transition-colors">Clear all</button>
      </div>

      {entries.map((entry) => {
        const isOpen = expanded.has(entry.id);
        const hasMatches = entry.matched.length > 0;
        return (
          <div key={entry.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <button onClick={() => toggle(entry.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors">
              {entry.error
                ? <XCircle className="w-4 h-4 text-destructive shrink-0" />
                : hasMatches
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <Clock className="w-4 h-4 text-muted-foreground/40 shrink-0" />}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium truncate">{entry.ruleName}</span>
                  {entry.auto && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                      <Bell className="w-2.5 h-2.5" />new mail
                    </span>
                  )}
                  {hasMatches && (
                    <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                      {entry.matched.length} match{entry.matched.length !== 1 ? "es" : ""}
                    </span>
                  )}
                  {!hasMatches && !entry.error && <span className="text-[10px] text-muted-foreground">no matches</span>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })} · {entry.messagesChecked} new messages checked
                </p>
              </div>

              {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            </button>

            {isOpen && (
              <div className="border-t border-border bg-muted/30">
                {entry.error && (
                  <div className="px-4 py-3 flex items-start gap-2 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{entry.error}
                  </div>
                )}
                {hasMatches ? (
                  <div className="divide-y divide-border/50">
                    {entry.matched.map((m) => (
                      <div key={m.messageId} className="px-4 py-2.5 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{m.subject}</p>
                            {m.from && <p className="text-[10px] text-muted-foreground truncate">{m.from}</p>}
                          </div>
                          <div className="flex flex-wrap gap-1 shrink-0">
                            {m.actionsApplied.map((a, i) => (
                              <span key={i} className={cn(
                                "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                                m.error ? "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" : "bg-primary/10 text-primary"
                              )}>{a}</span>
                            ))}
                          </div>
                        </div>
                        {m.error && (
                          <p className="text-[10px] text-destructive flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />{m.error}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  !entry.error && <p className="px-4 py-3 text-xs text-muted-foreground">No new messages matched this rule's conditions.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = "rules" | "history";

export default function RulesPage() {
  const { data: rules, isLoading, error, refetch } = useRules();
  const deleteRule = useDeleteRule();
  const { runRule, runningId } = useRuleRunner();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>("rules");
  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<MailRule | null>(null);
  const [deletingRule, setDeletingRule] = useState<MailRule | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => loadLog());
  const [watches, setWatches] = useState(() => loadWatches());

  const refreshLog = useCallback(() => setLogEntries(loadLog()), []);
  const refreshWatches = useCallback(() => setWatches(loadWatches()), []);

  // Refresh log periodically so "last checked" times stay current
  useEffect(() => {
    const id = setInterval(() => { refreshLog(); refreshWatches(); }, 15_000);
    return () => clearInterval(id);
  }, [refreshLog, refreshWatches]);

  const handleEdit = (rule: MailRule) => { setEditingRule(rule); setFormOpen(true); };
  const handleNew = () => { setEditingRule(null); setFormOpen(true); };
  const handleCloseForm = () => { setFormOpen(false); setEditingRule(null); };

  const handleConfirmDelete = () => {
    if (!deletingRule) return;
    deleteRule.mutate(deletingRule.id, {
      onSuccess: () => {
        clearLogForRule(deletingRule.id);
        removeWatch(deletingRule.id);
        refreshLog();
        refreshWatches();
        toast({ title: "Rule deleted" });
        setDeletingRule(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete rule", description: err.message, variant: "destructive" });
        setDeletingRule(null);
      },
    });
  };

  const handleRun = async (rule: MailRule) => {
    try {
      const result = await runRule(rule);
      refreshLog();
      if (result.matched.length === 0) {
        toast({ title: "No matches found", description: `Checked ${result.messagesChecked} inbox messages — none matched.` });
      } else {
        toast({ title: `Rule matched ${result.matched.length} message${result.matched.length !== 1 ? "s" : ""}`, description: "Actions applied. See History for details." });
        setActiveTab("history");
      }
    } catch (err) {
      toast({ title: "Rule run failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const enabledCount = rules?.filter((r) => r.isEnabled).length ?? 0;
  const watchingCount = watches.filter((w) => w.enabled).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center border-b border-border bg-background shrink-0 h-11 px-4 gap-3">
        <div className="flex items-center gap-0.5">
          {(["rules", "history"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {tab === "rules" ? <Filter className="w-3 h-3" /> : <History className="w-3 h-3" />}
              {tab === "rules" ? "Rules" : "History"}
              {tab === "rules" && rules && rules.length > 0 && (
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-semibold", activeTab === "rules" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {enabledCount}/{rules.length}
                </span>
              )}
              {tab === "history" && logEntries.length > 0 && (
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-semibold", activeTab === "history" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {logEntries.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {activeTab === "rules" && (
          <div className="flex items-center gap-1.5">
            {/* Watcher status indicator */}
            {watchingCount > 0 && (
              <span
                title="Rules are watching for new mail — checks every minute automatically"
                className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded-full"
              >
                <Bell className="w-2.5 h-2.5" />
                {watchingCount} watching
              </span>
            )}
            <button onClick={() => refetch()} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Refresh rules">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <Button size="sm" onClick={handleNew} className="h-8 text-xs gap-1.5">
              <Plus className="w-3.5 h-3.5" />New Rule
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "history" ? (
          <HistoryTab entries={logEntries} onClear={() => { clearLog(); refreshLog(); toast({ title: "History cleared" }); }} />
        ) : isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading rules…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
            <AlertCircle className="w-8 h-8 text-destructive/50" />
            <div>
              <p className="text-sm font-medium">Could not load rules</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {error.message.includes("403") || error.message.includes("401")
                  ? "Your token may not have the MailboxSettings.Read permission required to access inbox rules."
                  : error.message}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="text-xs h-7">Retry</Button>
          </div>
        ) : rules?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-6">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <Filter className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-medium">No rules yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">Rules automatically sort, mark, or delete incoming messages based on sender or keywords.</p>
            </div>
            <Button size="sm" onClick={handleNew} className="h-8 text-xs gap-1.5">
              <Plus className="w-3.5 h-3.5" />Create your first rule
            </Button>
          </div>
        ) : (
          <div className="p-4 space-y-2 max-w-2xl">
            <p className="text-[11px] text-muted-foreground mb-3">
              Rules run client-side against your inbox. Enable <strong>Watch</strong> on a rule to apply it automatically whenever new mail arrives. Use <strong>Run Now</strong> to apply it immediately.
            </p>
            {(rules ?? []).map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                isRunning={runningId === rule.id}
                isWatching={watches.some((w) => w.ruleId === rule.id && w.enabled)}
                onEdit={handleEdit}
                onDelete={setDeletingRule}
                onRun={handleRun}
                onWatchChange={refreshWatches}
              />
            ))}
          </div>
        )}
      </div>

      {formOpen && <RuleFormDialog open={formOpen} onClose={handleCloseForm} editing={editingRule} />}

      <AlertDialog open={!!deletingRule} onOpenChange={(v) => !v && setDeletingRule(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold">Delete rule?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              "{deletingRule?.displayName}" will be permanently deleted. Its watch settings and run history will also be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="text-xs h-8 bg-destructive hover:bg-destructive/90" disabled={deleteRule.isPending}>
              {deleteRule.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
