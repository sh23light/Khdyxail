export interface LogMatch {
  messageId: string;
  subject: string;
  from: string;
  actionsApplied: string[];
  error?: string;
}

export interface LogEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  timestamp: string;
  messagesChecked: number;
  matched: LogMatch[];
  error?: string;
  auto?: boolean;
}

const STORAGE_KEY = "webmail:rule-log";
const MAX_ENTRIES = 200;

export function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LogEntry[];
  } catch {
    return [];
  }
}

export function appendLogEntry(entry: LogEntry): void {
  const entries = loadLog();
  const trimmed = [entry, ...entries].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export function clearLog(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function clearLogForRule(ruleId: string): void {
  const entries = loadLog().filter((e) => e.ruleId !== ruleId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
