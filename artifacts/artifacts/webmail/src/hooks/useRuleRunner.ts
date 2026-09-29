import { useState, useCallback } from "react";
import { appendLogEntry, type LogMatch } from "@/lib/ruleLog";
import type { MailRule } from "@/hooks/useRules";
import { apiUrl } from "@/lib/apiBase";

function authHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

interface SimpleMessage {
  id: string;
  subject: string | null;
  from: { address: string; name: string | null };
  bodyPreview: string | null;
  isRead: boolean;
}

function matchesRule(rule: MailRule, msg: SimpleMessage): boolean {
  const c = rule.conditions;
  const addr = (msg.from.address ?? "").toLowerCase();
  const name = (msg.from.name ?? "").toLowerCase();
  const subj = (msg.subject ?? "").toLowerCase();
  const preview = (msg.bodyPreview ?? "").toLowerCase();
  const checks: boolean[] = [];
  if (c.senderContains?.length)
    checks.push(c.senderContains.some((s) => addr.includes(s.toLowerCase()) || name.includes(s.toLowerCase())));
  if (c.fromAddresses?.length)
    checks.push(c.fromAddresses.some((f) => f.emailAddress.address.toLowerCase() === addr));
  if (c.subjectContains?.length)
    checks.push(c.subjectContains.some((s) => subj.includes(s.toLowerCase())));
  if (c.bodyContains?.length)
    checks.push(c.bodyContains.some((s) => preview.includes(s.toLowerCase())));
  if (checks.length === 0) return false;
  return checks.some(Boolean);
}

function describeActions(rule: MailRule): string[] {
  const a = rule.actions;
  const labels: string[] = [];
  if (a.moveToFolder) labels.push(`Move to ${a.moveToFolder}`);
  if (a.markAsRead) labels.push("Mark as read");
  if (a.markImportance && a.markImportance !== "normal")
    labels.push(`Mark ${a.markImportance} importance`);
  if (a.delete) labels.push("Delete");
  return labels;
}

async function applyActionsToMessage(rule: MailRule, msgId: string): Promise<string[]> {
  const a = rule.actions;
  const applied: string[] = [];
  if (a.moveToFolder) {
    const res = await fetch(apiUrl(`/api/email/messages/${msgId}/move`), {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ destinationFolderId: a.moveToFolder }),
    });
    if (res.ok) applied.push(`Moved to ${a.moveToFolder}`);
  }
  if (a.markAsRead) {
    const res = await fetch(apiUrl(`/api/email/messages/${msgId}/read`), {
      method: "PATCH", headers: authHeaders(),
      body: JSON.stringify({ isRead: true }),
    });
    if (res.ok) applied.push("Marked as read");
  }
  if (a.markImportance && a.markImportance !== "normal") {
    const res = await fetch(apiUrl(`/api/email/messages/${msgId}/importance`), {
      method: "PATCH", headers: authHeaders(),
      body: JSON.stringify({ importance: a.markImportance }),
    });
    if (res.ok) applied.push(`Marked ${a.markImportance} importance`);
  }
  if (a.delete) {
    const res = await fetch(apiUrl(`/api/email/messages/${msgId}`), {
      method: "DELETE", headers: authHeaders(),
    });
    if (res.ok) applied.push("Deleted");
  }
  return applied;
}

export interface RunResult {
  messagesChecked: number;
  matched: LogMatch[];
}

/**
 * Run one rule against the full inbox manually (Run Now).
 * Respects stopProcessingRules across all enabled rules when allRules is provided.
 */
export function useRuleRunner() {
  const [runningId, setRunningId] = useState<string | null>(null);

  const runRule = useCallback(async (
    rule: MailRule,
    options?: { auto?: boolean; allRules?: MailRule[] }
  ): Promise<RunResult> => {
    setRunningId(rule.id);
    try {
      const res = await fetch(apiUrl("/api/email/messages?folder=inbox&top=50"), {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to fetch messages: HTTP ${res.status}`);
      const data = (await res.json()) as { messages: SimpleMessage[] };
      const messages = data.messages ?? [];

      const rulesInOrder = options?.allRules
        ? [...options.allRules].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        : [rule];

      const stoppedIds = new Set<string>();
      let targetMatched: LogMatch[] = [];

      for (const r of rulesInOrder) {
        if (!r.isEnabled) continue;
        const eligible = messages.filter((m) => !stoppedIds.has(m.id));
        const matching = eligible.filter((msg) => matchesRule(r, msg));
        const matched: LogMatch[] = [];

        for (const msg of matching) {
          let actionsApplied: string[] = [];
          let error: string | undefined;
          try {
            actionsApplied = await applyActionsToMessage(r, msg.id);
            if (actionsApplied.length === 0) actionsApplied = describeActions(r);
          } catch (err) {
            error = err instanceof Error ? err.message : "Unknown error";
            actionsApplied = describeActions(r);
          }
          if (r.actions.stopProcessingRules) stoppedIds.add(msg.id);
          matched.push({
            messageId: msg.id,
            subject: msg.subject ?? "(no subject)",
            from: msg.from.name ? `${msg.from.name} <${msg.from.address}>` : msg.from.address,
            actionsApplied,
            error,
          });
        }

        appendLogEntry({
          id: crypto.randomUUID(),
          ruleId: r.id,
          ruleName: r.displayName,
          timestamp: new Date().toISOString(),
          messagesChecked: eligible.length,
          matched,
          auto: options?.auto ?? false,
        });

        if (r.id === rule.id) targetMatched = matched;
      }

      return { messagesChecked: messages.length, matched: targetMatched };
    } finally {
      setRunningId(null);
    }
  }, []);

  return { runRule, runningId };
}
