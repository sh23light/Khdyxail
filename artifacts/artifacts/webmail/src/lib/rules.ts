export type ConditionType = "sender" | "subject" | "keyword";
export type ActionType = "move" | "markRead" | "delete";
export type ConditionMode = "any" | "all";

export interface RuleCondition {
  id: string;
  type: ConditionType;
  value: string;
}

export interface RuleAction {
  id: string;
  type: ActionType;
  folder?: string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  conditionMode: ConditionMode;
  conditions: RuleCondition[];
  actions: RuleAction[];
  createdAt: string;
  matchCount: number;
}

const STORAGE_KEY = "webmail:rules";

export function loadRules(): Rule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Rule[];
  } catch {
    return [];
  }
}

export function saveRules(rules: Rule[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

export function createRule(partial: Omit<Rule, "id" | "createdAt" | "matchCount">): Rule {
  return {
    ...partial,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    matchCount: 0,
  };
}

export function messageMatchesRule(
  rule: Rule,
  msg: { from?: { emailAddress?: { address?: string; name?: string } }; subject?: string | null }
): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;

  const sender = (msg.from?.emailAddress?.address ?? "").toLowerCase();
  const senderName = (msg.from?.emailAddress?.name ?? "").toLowerCase();
  const subject = (msg.subject ?? "").toLowerCase();

  const results = rule.conditions.map((c) => {
    const val = c.value.toLowerCase().trim();
    if (!val) return false;
    switch (c.type) {
      case "sender":
        return sender.includes(val) || senderName.includes(val);
      case "subject":
        return subject.includes(val);
      case "keyword":
        return sender.includes(val) || senderName.includes(val) || subject.includes(val);
    }
  });

  return rule.conditionMode === "all" ? results.every(Boolean) : results.some(Boolean);
}

export const FOLDER_OPTIONS = [
  { id: "inbox", label: "Inbox" },
  { id: "sentItems", label: "Sent Items" },
  { id: "drafts", label: "Drafts" },
  { id: "archive", label: "Archive" },
  { id: "deletedItems", label: "Deleted Items" },
  { id: "junkemail", label: "Junk" },
];
