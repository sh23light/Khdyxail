import { useEffect, useRef, useCallback } from "react";
import { appendLogEntry } from "@/lib/ruleLog";
import {
  loadWatches,
  updateWatchAfterCheck,
  getWatch,
  markProcessed,
} from "@/lib/ruleSchedule";
import { loadRulesFromStorage } from "@/hooks/useRules";
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
  receivedDateTime?: string | null;
}

function matchesRule(rule: MailRule, msg: SimpleMessage): boolean {
  const c = rule.conditions;
  // Guard against messages with a null `from` field
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
  return checks.length > 0 && checks.some(Boolean);
}

interface ActionResult {
  applied: string[];
  error?: string;
}

async function applyActions(rule: MailRule, msgId: string): Promise<ActionResult> {
  const a = rule.actions;
  const applied: string[] = [];
  const errors: string[] = [];

  if (a.moveToFolder) {
    try {
      const r = await fetch(apiUrl(`/api/email/messages/${msgId}/move`), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ destinationFolderId: a.moveToFolder }),
      });
      if (r.ok) {
        applied.push(`Moved to ${a.moveToFolder}`);
      } else {
        const body = await r.text().catch(() => "");
        errors.push(`Move failed: HTTP ${r.status}${body ? ` — ${body.slice(0, 120)}` : ""}`);
      }
    } catch (e) {
      errors.push(`Move error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (a.markAsRead) {
    try {
      const r = await fetch(apiUrl(`/api/email/messages/${msgId}/read`), {
        method: "PATCH",
        headers: authHeaders(),
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
        method: "DELETE",
        headers: authHeaders(),
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

  return {
    applied,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

/**
 * Global background watcher — runs in MainLayout so it persists across all pages.
 * Checks every 60s for new mail and applies rules that have "Watch" enabled.
 *
 * Uses ID-based tracking (not a time watermark) to decide which messages to act on.
 * This avoids clock-skew issues and correctly handles emails that were in the
 * inbox before the watch was enabled.
 */
export function useRuleScheduler(
  onAutoRun?: (ruleName: string, matchCount: number) => void
) {
  const isRunning = useRef(false);
  const onAutoRunRef = useRef(onAutoRun);
  onAutoRunRef.current = onAutoRun;

  const checkForNewMail = useCallback(async () => {
    if (isRunning.current) return;

    const watches = loadWatches().filter((w) => w.enabled);
    if (watches.length === 0) return;

    const allRules = loadRulesFromStorage();
    const watchingRuleIds = new Set(watches.map((w) => w.ruleId));
    const activeRules = allRules
      .filter((r) => r.isEnabled && !r.isReadOnly && watchingRuleIds.has(r.id))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    if (activeRules.length === 0) return;

    isRunning.current = true;
    try {
      const res = await fetch(apiUrl("/api/email/messages?folder=inbox&top=50"), {
        headers: authHeaders(),
      });
      if (!res.ok) return;

      const data = (await res.json()) as { messages: SimpleMessage[] };
      const allMessages = data.messages ?? [];
      const now = new Date().toISOString();
      const stoppedIds = new Set<string>();

      for (const rule of activeRules) {
        const watch = getWatch(rule.id);
        // IDs already successfully processed by this rule — skip them
        const processedIdSet = new Set(watch?.processedIds ?? []);

        // Eligible = not stopped by a previous rule, not already processed
        const eligible = allMessages.filter(
          (m) => !stoppedIds.has(m.id) && !processedIdSet.has(m.id)
        );
        const matching = eligible.filter((m) => {
          try {
            return matchesRule(rule, m);
          } catch {
            return false;
          }
        });

        const matched: {
          messageId: string;
          subject: string;
          from: string;
          actionsApplied: string[];
          error?: string;
        }[] = [];

        const successIds: string[] = [];

        for (const msg of matching) {
          const result = await applyActions(rule, msg.id);
          if (rule.actions.stopProcessingRules) stoppedIds.add(msg.id);
          // Only track as processed if at least one action succeeded
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

        // Persist successfully processed IDs so we don't re-act on them
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

        if (matched.length > 0) {
          onAutoRunRef.current?.(rule.displayName, matched.length);
        }
      }
    } catch {
      // Silently ignore top-level network errors
    } finally {
      isRunning.current = false;
    }
  }, []);

  useEffect(() => {
    checkForNewMail();
    const id = setInterval(checkForNewMail, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkForNewMail]);
}
