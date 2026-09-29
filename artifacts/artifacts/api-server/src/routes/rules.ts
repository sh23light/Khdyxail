import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { fetchWithTimeout } from "../lib/fetchWithTimeout.js";
import { getAccessToken } from "../lib/token.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function handleError(res: Response, err: unknown) {
  if (err instanceof Error && "status" in err) {
    const status = (err as { status: number }).status;
    const body = (err as { body?: string }).body;
    let message = err.message;
    try {
      if (body) {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      }
    } catch { /* ignore */ }
    res.status(status).json({ error: message });
  } else {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function graphRequest(
  method: string,
  token: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const resp = await fetchWithTimeout(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(method === "GET" ? {} : {}),
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`Graph API error: ${resp.status}`), {
      status: resp.status,
      body: text,
    });
  }
  if (resp.status === 204 || resp.headers.get("content-length") === "0") return null;
  return resp.json() as Promise<unknown>;
}

function mapRule(r: Record<string, unknown>) {
  const conditions = (r.conditions as Record<string, unknown> | null) ?? {};
  const actions = (r.actions as Record<string, unknown> | null) ?? {};
  return {
    id: r.id as string,
    displayName: (r.displayName as string) ?? "",
    sequence: (r.sequence as number) ?? 1,
    isEnabled: (r.isEnabled as boolean) ?? true,
    hasError: (r.hasError as boolean) ?? false,
    isReadOnly: (r.isReadOnly as boolean) ?? false,
    conditions: {
      senderContains: (conditions.senderContains as string[] | null) ?? [],
      subjectContains: (conditions.subjectContains as string[] | null) ?? [],
      bodyContains: (conditions.bodyContains as string[] | null) ?? [],
      fromAddresses: (conditions.fromAddresses as Array<Record<string, unknown>> | null) ?? [],
    },
    actions: {
      moveToFolder: (actions.moveToFolder as string | null) ?? null,
      markAsRead: (actions.markAsRead as boolean | null) ?? false,
      delete: (actions.delete as boolean | null) ?? false,
      markImportance: (actions.markImportance as string | null) ?? null,
      stopProcessingRules: (actions.stopProcessingRules as boolean | null) ?? false,
    },
  };
}

const router = Router();
const ruleIdSchema = z.string().trim().min(1).max(500);
const addressSchema = z.object({
  emailAddress: z.object({
    name: z.string().max(320).optional(),
    address: z.string().email().max(320),
  }),
});
const conditionsSchema = z.object({
  senderContains: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  subjectContains: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  bodyContains: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  fromAddresses: z.array(addressSchema).max(20).optional(),
}).strict();
const actionsSchema = z.object({
  moveToFolder: z.string().trim().min(1).max(200).nullable().optional(),
  markAsRead: z.boolean().optional(),
  delete: z.boolean().optional(),
  markImportance: z.enum(["low", "normal", "high"]).nullable().optional(),
  stopProcessingRules: z.boolean().optional(),
}).strict();
const createRuleSchema = z.object({
  displayName: z.string().trim().min(1).max(255),
  sequence: z.number().int().min(1).max(100_000).optional(),
  isEnabled: z.boolean().optional(),
  conditions: conditionsSchema.default({}),
  actions: actionsSchema.default({}),
}).strict();
const updateRuleSchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  sequence: z.number().int().min(1).max(100_000).optional(),
  isEnabled: z.boolean().optional(),
  conditions: conditionsSchema.optional(),
  actions: actionsSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

router.get("/email/rules", async (req: Request, res: Response) => {
  const token = await getAccessToken(req);
  if (!token) { res.status(401).json({ error: "No access token" }); return; }

  try {
    const data = await graphRequest("GET", token, "/me/mailFolders/inbox/messageRules") as Record<string, unknown>;
    const rules = (data.value as Array<Record<string, unknown>> ?? []).map(mapRule);
    res.json({ rules });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/rules", async (req: Request, res: Response) => {
  const token = await getAccessToken(req);
  if (!token) { res.status(401).json({ error: "No access token" }); return; }

  const parsed = createRuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid rule input" }); return; }
  const { displayName, sequence, isEnabled, conditions, actions } = parsed.data;

  try {
    const data = await graphRequest("POST", token, "/me/mailFolders/inbox/messageRules", {
      displayName,
      sequence: sequence ?? 1,
      isEnabled: isEnabled ?? true,
      conditions: conditions ?? {},
      actions: actions ?? {},
    }) as Record<string, unknown>;
    res.status(201).json(mapRule(data));
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/email/rules/:id", async (req: Request, res: Response) => {
  const token = await getAccessToken(req);
  if (!token) { res.status(401).json({ error: "No access token" }); return; }

  const parsedId = ruleIdSchema.safeParse(req.params.id);
  if (!parsedId.success) { res.status(400).json({ error: "Invalid rule id" }); return; }
  const parsed = updateRuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid rule input" }); return; }
  const id = parsedId.data;
  const payload = parsed.data;

  try {
    const data = await graphRequest(
      "PATCH",
      token,
      `/me/mailFolders/inbox/messageRules/${id}`,
      payload,
    ) as Record<string, unknown>;
    res.json(mapRule(data));
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/email/rules/:id", async (req: Request, res: Response) => {
  const token = await getAccessToken(req);
  if (!token) { res.status(401).json({ error: "No access token" }); return; }

  const parsedId = ruleIdSchema.safeParse(req.params.id);
  if (!parsedId.success) { res.status(400).json({ error: "Invalid rule id" }); return; }
  const id = parsedId.data;

  try {
    await graphRequest("DELETE", token, `/me/mailFolders/inbox/messageRules/${id}`);
    res.status(204).send();
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
