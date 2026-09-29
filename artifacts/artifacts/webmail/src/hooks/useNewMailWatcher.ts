import { useEffect, useRef, useCallback, useState } from "react";
import {
  loadWatches,
  updateWatchAfterCheck,
  getWatch,
  markProcessed,
} from "@/lib/ruleSchedule";
import { appendLogEntry, type LogMatch } from "@/lib/ruleLog";
import type { MailRule } from "@/hooks/useRules";
import { apiUrl } from "@/lib/apiBase";

const POLL_INTERVAL_MS = 60_000;

function authHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

interface SimpleMessage {
  id: string;
  subject: string | null;
  from: { address: string; name: string | null } | null;
  bodyPreview: string | null;
  receivedDateTime: string | null;
  isRead: boolean;
}

function matchesRule(rule: MailRule, msg: SimpleMessage): boolean {
  const c = rule.conditions;
  const addr = (msg.from?.address ?? "").toLowerCase();
  const name = (msg.from?.name ?? "").toLowerCase();
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

async function applyAction(rule: MailRule, msgId: string): Promise<{ applied: string[]; error?: string }> {
  const a = rule.actions;
  const applied: string[] = [];
  const errors: string[] = [];

  if (a.moveToFolder) {
    try {
      const r = await fetch(apiUrl(`/api/email/messages/${msgId}/move`), {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ destinationFolderId: a.moveToFolder }),
      });
      if (r.ok) {
        applied.push(`Moved to ${a.moveToFolder}`);
      } else {
        errors.push(`Move failed: HTTP ${r.status}`);
      }
    } catch (e) {
      errors.push(`Move error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (a.markAsRead) {
    try {
      const r = await fetch(apiUrl(`/api/email/messages/${msgId}/read`), {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ isRead: true }),
      });
      if (r.ok) {
        applied.push("Marked as read");
      } else {
        errors.push(`Mark-read failed: HTTP ${r.status}`);
      }
    } catch (e) {
      errors.push(`Mark-read error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (a.delete) {
    try {
      const r = await fetch(apiUrl(`/api/email/messages/${msgId}`), {
        method: "DELETE", headers: authHeaders(),
      });
      if (r.ok) {
        applied.push("Deleted");
      } else {
        errors.push(`Delete failed: HTTP ${r.status}`);
      }
    } catch (e) {
      errors.push(`Delete error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { applied, error: errors.length ? errors.join("; ") : undefined };
}

export interface WatcherStatus {
  lastCheckedAt: Date | null;
  isChecking: boolean;
  activeRuleCount: number;
}

export function useNewMailWatcher(rules: MailRule[] | undefined) {
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const [status, setStatus] = useState<WatcherStatus>({
    lastCheckedAt: null,
    isChecking: false,
    activeRuleCount: 0,
  });
  const isCheckingRef = useRef(false);

  const checkForNewMail = useCallback(async () => {
    if (isCheckingRef.current) return;
    const allRules = rulesRef.current;
    if (!allRules || allRules.length === 0) return;

    const watches = loadWatches().filter((w) => w.enabled);
    const watchingRuleIds = new Set(watches.map((w) => w.ruleId));
    const activeRules = allRules.filter(
      (r) => r.isEnabled && !r.isReadOnly && watchingRuleIds.has(r.id)
    );
    if (activeRules.length === 0) return;

    isCheckingRef.current = true;
    setStatus((s) => ({ ...s, isChecking: true, activeRuleCount: activeRules.length }));

    try {
      const res = await fetch(apiUrl("/api/email/messages?folder=inbox&top=50"), {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: SimpleMessage[] };
      const allMessages = data.messages ?? [];
      const now = new Date().toISOString();

      const stoppedIds = new Set<string>();
      const sortedRules = [...activeRules].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

      for (const rule of sortedRules) {
        const watch = getWatch(rule.id);
        const processedIdSet = new Set(watch?.processedIds ?? []);

        const eligible = allMessages.filter(
          (m) => !stoppedIds.has(m.id) && !processedIdSet.has(m.id)
        );
        const matching = eligible.filter((m) => {
          try { return matchesRule(rule, m); } catch { return false; }
        });

        const matched: LogMatch[] = [];
        const successIds: string[] = [];

        for (const msg of matching) {
          const result = await applyAction(rule, msg.id);
          if (rule.actions.stopProcessingRules) stoppedIds.add(msg.id);
          if (result.applied.length > 0) successIds.push(msg.id);
          matched.push({
            messageId: msg.id,
            subject: msg.subject ?? "(no subject)",
            from: msg.from?.name
              ? `${msg.from.name} <${msg.from.address}>`
              : (msg.from?.address ?? "(unknown)"),
            actionsApplied: result.applied,
            error: result.error,
          });
        }

        markProcessed(rule.id, successIds);
        updateWatchAfterCheck(rule.id, now);

        appendLogEntry({
          id: crypto.randomUUID(),
          ruleId: rule.id,
          ruleName: rule.displayName,
          timestamp: now,
          messagesChecked: eligible.length,
          matched,
          auto: true,
        });
      }

      setStatus({ lastCheckedAt: new Date(), isChecking: false, activeRuleCount: activeRules.length });
    } catch {
      setStatus((s) => ({ ...s, isChecking: false }));
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const watches = loadWatches().filter((w) => w.enabled);
    const watchingRuleIds = new Set(watches.map((w) => w.ruleId));
    const count = (rules ?? []).filter(
      (r) => r.isEnabled && !r.isReadOnly && watchingRuleIds.has(r.id)
    ).length;
    setStatus((s) => ({ ...s, activeRuleCount: count }));
  }, [rules]);

  useEffect(() => {
    checkForNewMail();
    const timer = setInterval(checkForNewMail, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkForNewMail]);

  return { status, checkNow: checkForNewMail };
}
