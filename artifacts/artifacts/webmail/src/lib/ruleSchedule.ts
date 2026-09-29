export interface RuleWatch {
  ruleId: string;
  enabled: boolean;
  lastSeenAt: string;
  lastCheckedAt: string | null;
  /** IDs of messages that have been successfully acted on by this rule (capped at 1000) */
  processedIds: string[];
}

const STORAGE_KEY = "webmail:rule-watches-v2";

export function loadWatches(): RuleWatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RuleWatch[];
    return parsed.map((w) => ({ ...w, processedIds: w.processedIds ?? [] }));
  } catch {
    return [];
  }
}

function saveWatches(watches: RuleWatch[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(watches));
}

export function getWatch(ruleId: string): RuleWatch | undefined {
  return loadWatches().find((w) => w.ruleId === ruleId);
}

export function setWatch(ruleId: string, enabled: boolean): void {
  const watches = loadWatches();
  const existing = watches.find((w) => w.ruleId === ruleId);
  const rest = watches.filter((w) => w.ruleId !== ruleId);
  const entry: RuleWatch = {
    ruleId,
    enabled,
    lastSeenAt: existing?.lastSeenAt ?? new Date().toISOString(),
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    processedIds: existing?.processedIds ?? [],
  };
  saveWatches([...rest, entry]);
}

export function updateWatchAfterCheck(ruleId: string, lastSeenAt: string): void {
  const watches = loadWatches();
  const idx = watches.findIndex((w) => w.ruleId === ruleId);
  const now = new Date().toISOString();
  if (idx === -1) {
    watches.push({ ruleId, enabled: true, lastSeenAt, lastCheckedAt: now, processedIds: [] });
  } else {
    watches[idx] = { ...watches[idx]!, lastSeenAt, lastCheckedAt: now };
  }
  saveWatches(watches);
}

/**
 * Mark message IDs as successfully processed for a rule.
 * Caps the stored list at 1000 to limit storage growth.
 */
export function markProcessed(ruleId: string, ids: string[]): void {
  if (ids.length === 0) return;
  const watches = loadWatches();
  const idx = watches.findIndex((w) => w.ruleId === ruleId);
  const now = new Date().toISOString();
  if (idx === -1) {
    watches.push({ ruleId, enabled: true, lastSeenAt: now, lastCheckedAt: now, processedIds: ids.slice(-1000) });
  } else {
    const existing = watches[idx]!;
    const combined = [...(existing.processedIds ?? []), ...ids];
    // Keep most recent 1000
    watches[idx] = { ...existing, processedIds: combined.slice(-1000), lastCheckedAt: now };
  }
  saveWatches(watches);
}

export function removeWatch(ruleId: string): void {
  saveWatches(loadWatches().filter((w) => w.ruleId !== ruleId));
}

export function getWatchingRuleIds(): string[] {
  return loadWatches()
    .filter((w) => w.enabled)
    .map((w) => w.ruleId);
}
