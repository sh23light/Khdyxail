import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface RuleConditions {
  senderContains: string[];
  subjectContains: string[];
  bodyContains: string[];
  fromAddresses: Array<{ emailAddress: { name?: string; address: string } }>;
}

export interface RuleActions {
  moveToFolder: string | null;
  markAsRead: boolean;
  delete: boolean;
  markImportance: "low" | "normal" | "high" | null;
  stopProcessingRules: boolean;
}

export interface MailRule {
  id: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  hasError: boolean;
  isReadOnly: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
}

export interface CreateRulePayload {
  displayName: string;
  sequence?: number;
  isEnabled?: boolean;
  conditions: Partial<RuleConditions>;
  actions: Partial<RuleActions>;
}

export const RULES_STORAGE_KEY = "webmail:email-rules-v2";

export function loadRulesFromStorage(): MailRule[] {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MailRule[]) : [];
  } catch {
    return [];
  }
}

function saveRulesToStorage(rules: MailRule[]): void {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {}
}

function mergeConditions(
  base: RuleConditions,
  patch: Partial<RuleConditions>
): RuleConditions {
  return {
    senderContains: patch.senderContains ?? base.senderContains,
    subjectContains: patch.subjectContains ?? base.subjectContains,
    bodyContains: patch.bodyContains ?? base.bodyContains,
    fromAddresses: patch.fromAddresses ?? base.fromAddresses,
  };
}

function mergeActions(
  base: RuleActions,
  patch: Partial<RuleActions>
): RuleActions {
  return {
    moveToFolder:
      "moveToFolder" in patch ? (patch.moveToFolder ?? null) : base.moveToFolder,
    markAsRead: patch.markAsRead ?? base.markAsRead,
    delete: patch.delete ?? base.delete,
    markImportance:
      "markImportance" in patch
        ? (patch.markImportance ?? null)
        : base.markImportance,
    stopProcessingRules:
      patch.stopProcessingRules ?? base.stopProcessingRules,
  };
}

export const RULES_QUERY_KEY = ["email-rules"];

export function useRules() {
  return useQuery<MailRule[], Error>({
    queryKey: RULES_QUERY_KEY,
    queryFn: () => loadRulesFromStorage(),
    staleTime: Infinity,
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation<MailRule, Error, CreateRulePayload>({
    mutationFn: async (payload) => {
      const rules = loadRulesFromStorage();
      const newRule: MailRule = {
        id: crypto.randomUUID(),
        displayName: payload.displayName || "Untitled Rule",
        sequence: rules.length + 1,
        isEnabled: payload.isEnabled ?? true,
        hasError: false,
        isReadOnly: false,
        conditions: {
          senderContains: payload.conditions.senderContains ?? [],
          subjectContains: payload.conditions.subjectContains ?? [],
          bodyContains: payload.conditions.bodyContains ?? [],
          fromAddresses: payload.conditions.fromAddresses ?? [],
        },
        actions: {
          moveToFolder: payload.actions.moveToFolder ?? null,
          markAsRead: payload.actions.markAsRead ?? false,
          delete: payload.actions.delete ?? false,
          markImportance: payload.actions.markImportance ?? null,
          stopProcessingRules: payload.actions.stopProcessingRules ?? false,
        },
      };
      saveRulesToStorage([...rules, newRule]);
      return newRule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation<
    MailRule,
    Error,
    { id: string; payload: Partial<CreateRulePayload> }
  >({
    mutationFn: async ({ id, payload }) => {
      const rules = loadRulesFromStorage();
      const idx = rules.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error("Rule not found");
      const base = rules[idx]!;
      const updated: MailRule = {
        ...base,
        displayName: payload.displayName ?? base.displayName,
        conditions: payload.conditions
          ? mergeConditions(base.conditions, payload.conditions)
          : base.conditions,
        actions: payload.actions
          ? mergeActions(base.actions, payload.actions)
          : base.actions,
      };
      rules[idx] = updated;
      saveRulesToStorage(rules);
      return updated;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      saveRulesToStorage(loadRulesFromStorage().filter((r) => r.id !== id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

export function useToggleRuleEnabled() {
  const qc = useQueryClient();
  return useMutation<MailRule, Error, { id: string; isEnabled: boolean }>({
    mutationFn: async ({ id, isEnabled }) => {
      const rules = loadRulesFromStorage();
      const idx = rules.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error("Rule not found");
      rules[idx] = { ...rules[idx]!, isEnabled };
      saveRulesToStorage(rules);
      return rules[idx]!;
    },
    onMutate: async ({ id, isEnabled }) => {
      await qc.cancelQueries({ queryKey: RULES_QUERY_KEY });
      const prev = qc.getQueryData<MailRule[]>(RULES_QUERY_KEY);
      qc.setQueryData<MailRule[]>(
        RULES_QUERY_KEY,
        (old) => old?.map((r) => (r.id === id ? { ...r, isEnabled } : r)) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const c = ctx as { prev?: MailRule[] } | undefined;
      if (c?.prev !== undefined) qc.setQueryData(RULES_QUERY_KEY, c.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}
