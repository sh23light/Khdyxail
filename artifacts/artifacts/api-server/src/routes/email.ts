import { Router, type Request, type Response } from "express";
import { isTrustedInternalRequest } from "../lib/auth";
import {
  ListMessagesQueryParams,
  GetMessageParams,
  DeleteMessageParams,
  MarkMessageReadParams,
  MarkMessageReadBody,
  MoveMessageParams,
  MoveMessageBody,
  ReplyToMessageParams,
  ReplyToMessageBody,
  ForwardMessageParams,
  ForwardMessageBody,
  ArchiveMessageParams,
  SendEmailBody,
  GetConversationParams,
  SearchMessagesQueryParams,
  AnalyzeMessageParams,
} from "@workspace/api-zod";
import { callAi, extractAiConfig } from "../lib/ai.js";
import { extractSystemPrompt } from "../lib/ai.js";
import { fetchWithTimeout } from "../lib/fetchWithTimeout.js";
import { getAccessTokens } from "../lib/token.js";
import type { TokenWithBase } from "../lib/token.js";

const GRAPH_TIMEOUT_MS = 8_000;

const FOLDER_MAP: Record<string, string> = {
  inbox: "inbox",
  sentItems: "sentItems",
  drafts: "drafts",
  outbox: "outbox",
  archive: "archive",
  deletedItems: "deletedItems",
  junkemail: "junkemail",
};

async function tryEachToken<T>(
  tokens: TokenWithBase[],
  fn: (token: string, baseUrl: string) => Promise<T>,
): Promise<T | null> {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    try { return await fn(tokens[0].token, tokens[0].baseUrl); } catch { return null; }
  }
  const results = await Promise.allSettled(tokens.map(t => fn(t.token, t.baseUrl)));
  for (const r of results) {
    if (r.status === "fulfilled") return r.value;
  }
  return null;
}

async function graphGet(
  token: string,
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
  extraHeaders?: Record<string, string>,
) {
  const url = new URL(`${baseUrl}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const resp = await fetchWithTimeout(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  }, GRAPH_TIMEOUT_MS);
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`API error: ${resp.status}`), { status: resp.status, body: text });
  }
  return resp.json() as Promise<unknown>;
}

async function graphPost(token: string, baseUrl: string, path: string, body: unknown) {
  const resp = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, GRAPH_TIMEOUT_MS);
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`API error: ${resp.status}`), { status: resp.status, body: text });
  }
  if (resp.status === 204 || resp.headers.get("content-length") === "0") return null;
  return resp.json() as Promise<unknown>;
}

async function graphPatch(token: string, baseUrl: string, path: string, body: unknown) {
  const resp = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, GRAPH_TIMEOUT_MS);
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`API error: ${resp.status}`), { status: resp.status, body: text });
  }
  return resp.json() as Promise<unknown>;
}

async function graphDelete(token: string, baseUrl: string, path: string) {
  const resp = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }, GRAPH_TIMEOUT_MS);
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`Graph API error: ${resp.status}`), { status: resp.status, body: text });
  }
}

function handleError(res: Response, err: unknown) {
  if (err instanceof Error && "status" in err) {
    const status = (err as { status: number }).status;
    res.status(status).json({ error: err.message });
  } else {
    res.status(500).json({ error: "Internal server error" });
  }
}

function mapMessage(msg: Record<string, unknown>, folder?: string) {
  const from = (msg.from as Record<string, Record<string, string>> | null)?.emailAddress;
  const toRecipients = ((msg.toRecipients as Array<Record<string, Record<string, string>>> | null) ?? []).map(
    (r) => ({ name: r.emailAddress?.name ?? null, address: r.emailAddress?.address ?? "" })
  );
  const ccRecipients = ((msg.ccRecipients as Array<Record<string, Record<string, string>>> | null) ?? []).map(
    (r) => ({ name: r.emailAddress?.name ?? null, address: r.emailAddress?.address ?? "" })
  );
  const flagStatus = (msg.flag as Record<string, string> | null)?.flagStatus;
  return {
    id: msg.id as string,
    subject: (msg.subject as string | null) ?? null,
    bodyPreview: (msg.bodyPreview as string | null) ?? null,
    body: (msg.body as Record<string, string> | null)?.content ?? null,
    isRead: (msg.isRead as boolean) ?? false,
    isDraft: (msg.isDraft as boolean) ?? false,
    receivedDateTime: (msg.receivedDateTime as string | null) ?? null,
    sentDateTime: (msg.sentDateTime as string | null) ?? null,
    from: { name: from?.name ?? null, address: from?.address ?? "" },
    toRecipients,
    ccRecipients,
    conversationId: (msg.conversationId as string | null) ?? null,
    hasAttachments: (msg.hasAttachments as boolean) ?? false,
    importance: (msg.importance as "low" | "normal" | "high") ?? "normal",
    folder: folder ?? null,
    isFlagged: flagStatus === "flagged",
  };
}

const router = Router();

const MESSAGE_SELECT =
  "id,subject,bodyPreview,isRead,isDraft,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,conversationId,hasAttachments,importance,flag";

router.get("/email/messages", async (req: Request, res: Response) => {
  const upn = req.query.upn as string | undefined;
  const tokens = await getAccessTokens(req, upn);
  if (tokens.length === 0) { console.warn(`[Email] /email/messages — no tokens`); res.status(401).json({ error: "No access token" }); return; }

  const parsed = ListMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query params" }); return; }

  const { folder, top = 50, skip = 0, search, filter } = parsed.data;
  const graphFolder = FOLDER_MAP[folder] ?? folder;

  try {
    const params: Record<string, string> = {
      "$select": MESSAGE_SELECT,
      "$top": String(top),
    };
    if (search) {
      params["$search"] = `"${search}"`;
    } else {
      params["$orderby"] = "receivedDateTime desc";
      params["$skip"] = String(skip);
    }
    if (filter) params["$filter"] = filter;

    const results = await Promise.all(
      tokens.map(async (twb) => {
        try {
          const data = await graphGet(twb.token, twb.baseUrl, `/me/mailFolders/${graphFolder}/messages`, params, { "ConsistencyLevel": "eventual" }) as Record<string, unknown>;
          return (data.value as Array<Record<string, unknown>> ?? []).map((m) => mapMessage(m, folder));
        } catch (err) {
          console.error(`[API] listMessages failed:`, (err as Error).message, (err as {body?:string}).body ?? "");
          return [];
        }
      })
    );

    const messages = results.flat().sort((a, b) => {
      if (!a.receivedDateTime) return 1;
      if (!b.receivedDateTime) return -1;
      return new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime();
    });

    const total = messages.length;
    res.json({ messages, total, hasMore: skip + messages.length < total });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/email/me/:id", async (req: Request, res: Response) => {
  const tokens = await getAccessTokens(req, req.query.upn as string | undefined);
  if (tokens.length === 0) { res.status(401).json({ error: "No access token" }); return; }

  const parsed = GetMessageParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const result = await tryEachToken(tokens, (token, baseUrl) =>
    graphGet(token, baseUrl, `/me/messages/${parsed.data.id}`, {
      "$select": `${MESSAGE_SELECT},body`,
    }) as Promise<Record<string, unknown>>
  );
  if (!result) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(mapMessage(result));
});

router.delete("/email/me/:id", async (req: Request, res: Response) => {
  const tokens = await getAccessTokens(req, req.query.upn as string | undefined);
  if (tokens.length === 0) { res.status(401).json({ error: "No access token" }); return; }

  const parsed = DeleteMessageParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const ok = await tryEachToken(tokens, (token, baseUrl) => graphDelete(token, baseUrl, `/me/messages/${parsed.data.id}`).then(() => true));
  if (!ok) { res.status(404).json({ error: "Message not found" }); return; }
  res.status(204).send();
});

router.patch("/email/me/:id/read", async (req: Request, res: Response) => {
  const tokens = await getAccessTokens(req, req.query.upn as string | undefined);
  if (tokens.length === 0) { res.status(401).json({ error: "No access token" }); return; }

  const paramsParsed = MarkMessageReadParams.safeParse(req.params);
  const bodyParsed = MarkMessageReadBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const result = await tryEachToken(tokens, (token, baseUrl) =>
    graphPatch(token, baseUrl, `/me/messages/${paramsParsed.data.id}`, {
      isRead: bodyParsed.data.isRead,
    }) as Promise<Record<string, unknown>>
  );
  if (!result) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(mapMessage(result));
});

router.post("/email/me/:id/move", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const paramsParsed = MoveMessageParams.safeParse(req.params);
  const bodyParsed = MoveMessageBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  try {
    const data = await graphPost(token, baseUrl, `/me/messages/${paramsParsed.data.id}/move`, {
      destinationId: bodyParsed.data.destinationFolderId,
    }) as Record<string, unknown>;
    res.json(mapMessage(data));
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/me/:id/reply", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const paramsParsed = ReplyToMessageParams.safeParse(req.params);
  const bodyParsed = ReplyToMessageBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  try {
    const draft = await graphPost(token, baseUrl, `/me/messages/${paramsParsed.data.id}/createReply`, {}) as Record<string, unknown>;
    const draftId = draft?.id as string;
    const updated = await graphPatch(token, baseUrl, `/me/messages/${draftId}`, {
      body: { contentType: "html", content: bodyParsed.data.body },
      ...(bodyParsed.data.toRecipients?.length
        ? { toRecipients: bodyParsed.data.toRecipients.map((r) => ({ emailAddress: r })) }
        : {}),
    }) as Record<string, unknown>;
    await graphPost(token, baseUrl, `/me/messages/${draftId}/send`, {});
    res.status(201).json(mapMessage(updated));
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/me/:id/forward", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const paramsParsed = ForwardMessageParams.safeParse(req.params);
  const bodyParsed = ForwardMessageBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  try {
    const draft = await graphPost(token, baseUrl, `/me/messages/${paramsParsed.data.id}/createForward`, {}) as Record<string, unknown>;
    const draftId = draft?.id as string;
    await graphPatch(token, baseUrl, `/me/messages/${draftId}`, {
      body: { contentType: "html", content: bodyParsed.data.body },
      toRecipients: bodyParsed.data.toRecipients.map((r) => ({ emailAddress: r })),
    });
    await graphPost(token, baseUrl, `/me/messages/${draftId}/send`, {});
    res.status(201).json(mapMessage(draft));
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/me/:id/archive", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const parsed = ArchiveMessageParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }

  try {
    const data = await graphPost(token, baseUrl, `/me/messages/${parsed.data.id}/move`, {
      destinationId: "archive",
    }) as Record<string, unknown>;
    res.json(mapMessage(data, "archive"));
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/send", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const parsed = SendEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error }); return; }

  try {
    const { subject, body, toRecipients, ccRecipients, bccRecipients, importance } = parsed.data;
    await graphPost(token, baseUrl, `/me/sendMail`, {
      message: {
        subject,
        body: { contentType: "html", content: body },
        toRecipients: toRecipients.map((r) => ({ emailAddress: r })),
        ccRecipients: (ccRecipients ?? []).map((r) => ({ emailAddress: r })),
        bccRecipients: (bccRecipients ?? []).map((r) => ({ emailAddress: r })),
        importance: importance ?? "normal",
      },
      saveToSentItems: true,
    });
    res.status(202).json({ success: true, messageId: null });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/email/conversations/:conversationId", async (req: Request, res: Response) => {
  const upn = req.query.upn as string | undefined;
  const tokens = await getAccessTokens(req, upn);
  if (tokens.length === 0) { res.status(401).json({ error: "No access token" }); return; }

  const parsed = GetConversationParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }

  try {
    const results = await Promise.all(
      tokens.map(async (twb) => {
        try {
          const data = await graphGet(twb.token, twb.baseUrl, "/me/messages", {
            "$filter": `conversationId eq '${parsed.data.conversationId}'`,
            "$select": MESSAGE_SELECT,
            "$orderby": "receivedDateTime asc",
          }) as Record<string, unknown>;
          return (data.value as Array<Record<string, unknown>> ?? []).map((m) => mapMessage(m));
        } catch (err) {
          console.error(`[Graph] conversations failed:`, (err as Error).message, (err as {body?:string}).body ?? "");
          return [];
        }
      })
    );
    const messages = results.flat();
    res.json({ messages, total: messages.length, hasMore: false });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/email/search", async (req: Request, res: Response) => {
  const upn = req.query.upn as string | undefined;
  const tokens = await getAccessTokens(req, upn);
  if (tokens.length === 0) { res.status(401).json({ error: "No access token" }); return; }

  const parsed = SearchMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }

  try {
    const results = await Promise.all(
      tokens.map(async (twb) => {
        try {
          const data = await graphGet(twb.token, twb.baseUrl, "/me/messages", {
            "$search": `"${parsed.data.q}"`,
            "$select": MESSAGE_SELECT,
            "$top": String(parsed.data.top ?? 25),
          }, { "ConsistencyLevel": "eventual" }) as Record<string, unknown>;
          return (data.value as Array<Record<string, unknown>> ?? []).map((m) => mapMessage(m));
        } catch (err) {
          console.error(`[Graph] search failed:`, (err as Error).message, (err as {body?:string}).body ?? "");
          return [];
        }
      })
    );
    const messages = results.flat();
    res.json({ messages, total: messages.length, hasMore: false });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/email/stats", async (req: Request, res: Response) => {
  const upn = req.query.upn as string | undefined;
  const tokens = await getAccessTokens(req, upn);
  if (tokens.length === 0) { console.warn(`[Email] /email/stats — no tokens`); res.status(401).json({ error: "No access token" }); return; }

  const folderDefs = [
    { folder: "inbox", displayName: "Inbox" },
    { folder: "sentItems", displayName: "Sent Items" },
    { folder: "drafts", displayName: "Drafts" },
    { folder: "outbox", displayName: "Outbox" },
    { folder: "archive", displayName: "Archive" },
    { folder: "deletedItems", displayName: "Deleted Items" },
    { folder: "junkemail", displayName: "Junk" },
  ];

  try {
    const aggregated = folderDefs.map(({ folder, displayName }) => ({
      folder, displayName, unreadCount: 0, totalCount: 0,
    }));

    for (const twb of tokens) {
      const results = await Promise.all(
        folderDefs.map(async ({ folder, displayName }) => {
          try {
            const data = await graphGet(twb.token, twb.baseUrl, `/me/mailFolders/${folder}`) as Record<string, unknown>;
            return {
              folder,
              displayName,
              unreadCount: (data.unreadItemCount as number) ?? 0,
              totalCount: (data.totalItemCount as number) ?? 0,
            };
          } catch (err) {
            console.error(`[Graph] stats failed for folder=${folder}:`, (err as Error).message, (err as {body?:string}).body ?? "");
            return { folder, displayName, unreadCount: 0, totalCount: 0 };
          }
        })
      );
      for (const r of results) {
        const agg = aggregated.find((a) => a.folder === r.folder);
        if (agg) { agg.unreadCount += r.unreadCount; agg.totalCount += r.totalCount; }
      }
    }

    const totalUnread = aggregated.reduce((sum, r) => sum + r.unreadCount, 0);
    res.json({ folders: aggregated, totalUnread });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/analysis/mailbox", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const body = req.body as Record<string, unknown>;
  let systemPrompt: string;
  try {
    systemPrompt = extractSystemPrompt(body);
  } catch (err) {
    handleError(res, err);
    return;
  }

  let aiConfig;
  try {
    aiConfig = extractAiConfig(body);
  } catch (err) {
    handleError(res, err);
    return;
  }

  try {
    const data = await graphGet(token, baseUrl, "/me/mailFolders/inbox/messages", {
      "$select": "id,subject,bodyPreview,from,receivedDateTime,isRead,importance",
      "$top": "20",
      "$orderby": "receivedDateTime desc",
    }) as Record<string, unknown>;

    const messages = ((data.value as Array<Record<string, unknown>>) ?? []).map((msg) => {
      const from = (msg.from as Record<string, Record<string, string>> | null)?.emailAddress;
      return {
        subject: (msg.subject as string | null) ?? "(no subject)",
        from: from?.address ?? "unknown",
        fromName: from?.name ?? "",
        preview: (msg.bodyPreview as string | null) ?? "",
        receivedDateTime: (msg.receivedDateTime as string | null) ?? "",
        isRead: (msg.isRead as boolean) ?? false,
        importance: (msg.importance as string) ?? "normal",
      };
    });

    const emailList = messages
      .map((m, i) =>
        `${i + 1}. Subject: "${m.subject}" | From: ${m.fromName || m.from} <${m.from}> | Date: ${m.receivedDateTime} | Read: ${m.isRead} | Importance: ${m.importance}\n   Preview: ${m.preview.slice(0, 200)}`
      )
      .join("\n\n");

    const analysis = await callAi(aiConfig, [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Analyze my inbox (${messages.length} most recent messages):\n\n${emailList}` },
    ]);

    res.json({
      overallSummary: (analysis.overallSummary as string) ?? "Unable to generate summary.",
      unreadCount: (analysis.unreadCount as number) ?? 0,
      urgentMessages: (analysis.urgentMessages as Array<{ subject: string; from: string; reason: string }>) ?? [],
      topSenders: (analysis.topSenders as Array<{ email: string; name: string; count: number }>) ?? [],
      actionItems: (analysis.actionItems as string[]) ?? [],
      categories: (analysis.categories as Array<{ name: string; count: number; description: string }>) ?? [],
      sentiment: (analysis.sentiment as string) ?? "neutral",
      recommendation: (analysis.recommendation as string) ?? "",
      analyzedCount: messages.length,
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/me/:id/ai-analysis", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const parsed = AnalyzeMessageParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }

  const body = req.body as Record<string, unknown>;
  let systemPrompt: string;
  try {
    systemPrompt = extractSystemPrompt(body);
  } catch (err) {
    handleError(res, err);
    return;
  }

  let aiConfig;
  try {
    aiConfig = extractAiConfig(body);
  } catch (err) {
    handleError(res, err);
    return;
  }

  try {
    const msg = await graphGet(token, baseUrl, `/me/messages/${parsed.data.id}`, {
      "$select": "id,subject,bodyPreview,body,from,receivedDateTime",
    }) as Record<string, unknown>;

    const bodyText = ((msg.body as Record<string, string> | null)?.content ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);

    const subject = (msg.subject as string | null) ?? "(no subject)";
    const from = (msg.from as Record<string, Record<string, string>> | null)?.emailAddress?.address ?? "unknown";

    const analysis = await callAi(aiConfig, [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Subject: ${subject}\nFrom: ${from}\n\n${bodyText}` },
    ]);

    res.json({
      summary: (analysis.summary as string) ?? "No summary available.",
      sentiment: (analysis.sentiment as string) ?? "neutral",
      actionItems: (analysis.actionItems as string[]) ?? [],
      suggestedReply: (analysis.suggestedReply as string | null) ?? null,
      priority: (analysis.priority as string) ?? "medium",
      keyTopics: (analysis.keyTopics as string[]) ?? [],
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/email/me/:id/attachments", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const id = req.params.id as string;
  try {
    const data = await graphGet(token, baseUrl, `/me/messages/${id}/attachments`, {
      "$select": "id,name,contentType,size",
    }) as Record<string, unknown>;
    const attachments = (data.value as Array<Record<string, unknown>> ?? []).map((a) => ({
      id: a.id as string,
      name: (a.name as string) ?? "attachment",
      contentType: (a.contentType as string) ?? "application/octet-stream",
      size: (a.size as number) ?? 0,
    }));
    res.json({ attachments });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/email/me/:id/attachments/:attachmentId", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const { id, attachmentId } = req.params as { id: string; attachmentId: string };
  try {
    const data = await graphGet(token, baseUrl, `/me/messages/${id}/attachments/${attachmentId}`) as Record<string, unknown>;
    const contentBytes = data.contentBytes as string | null;
    const contentType = (data.contentType as string) ?? "application/octet-stream";
    const name = (data.name as string) ?? "attachment";

    if (!contentBytes) {
      res.status(404).json({ error: "Attachment has no content" });
      return;
    }

    const buffer = Buffer.from(contentBytes, "base64");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/email/me/:id/flag", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const id = req.params.id as string;
  const { flagged } = req.body as { flagged: boolean };

  try {
    const data = await graphPatch(token, baseUrl, `/me/messages/${id}`, {
      flag: { flagStatus: flagged ? "flagged" : "notFlagged" },
    }) as Record<string, unknown>;
    res.json(mapMessage(data));
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/email/me/:id/importance", async (req: Request, res: Response) => {
  const twb = await getAccessTokens(req, req.query.upn as string | undefined);
  if (twb.length === 0) { res.status(401).json({ error: "No access token" }); return; }
  const token = twb[0]!.token;
  const baseUrl = twb[0]!.baseUrl;

  const id = req.params.id as string;
  const { importance } = req.body as { importance: "low" | "normal" | "high" };
  if (!["low", "normal", "high"].includes(importance)) {
    res.status(400).json({ error: "importance must be low, normal, or high" });
    return;
  }

  try {
    const data = await graphPatch(token, baseUrl, `/me/messages/${id}`, { importance }) as Record<string, unknown>;
    res.json(mapMessage(data));
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/email/keyword-check", async (req: Request, res: Response) => {
  if (!isTrustedInternalRequest(req)) {
    res.status(403).json({ error: "Internal service authentication required" });
    return;
  }

  const body = req.body as {
    keywords?: string[];
    mailboxEmail?: string;
    folder?: string;
    since?: string;
    maxMessages?: number;
  };

  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k) => typeof k === "string" && k.length > 0)
    : [];
  if (keywords.length === 0) {
    res.status(400).json({ error: "keywords must be a non-empty array of strings" });
    return;
  }

  const folder = typeof body.folder === "string" ? body.folder : "inbox";
  const top = typeof body.maxMessages === "number" ? Math.min(body.maxMessages, 100) : 50;
  const graphFolder = FOLDER_MAP[folder] ?? folder;

  try {
    const tokens = body.mailboxEmail
      ? await getAccessTokens(req, body.mailboxEmail)
      : await getAccessTokens(req);

    if (tokens.length === 0) {
      res.json({ matches: [], checkedCount: 0, checkTimestamp: new Date().toISOString() });
      return;
    }

    const checkTimestamp = new Date().toISOString();
    const results = await Promise.all(
      tokens.map(async (twb) => {
        try {
          const params: Record<string, string> = {
            "$select": "id,subject,from,receivedDateTime,bodyPreview",
            "$top": String(top),
            "$orderby": "receivedDateTime desc",
          };
          if (body.since) {
            params["$filter"] = `receivedDateTime ge ${body.since}`;
          }
          const data = await graphGet(twb.token, twb.baseUrl, `/me/mailFolders/${graphFolder}/messages`, params, { "ConsistencyLevel": "eventual" }) as Record<string, unknown>;
          return (data.value as Array<Record<string, unknown>> ?? []) as Array<Record<string, unknown>>;
        } catch (err) {
          console.error(`[Graph] keyword-check failed:`, (err as Error).message, (err as {body?:string}).body ?? "");
          return [];
        }
      })
    );

    const allMessages = results.flat();
    const seen = new Set<string>();
    const matches: Array<Record<string, unknown>> = [];

    for (const msg of allMessages) {
      if (seen.has(msg.id as string)) continue;
      seen.add(msg.id as string);

      const searchText = [
        msg.subject,
        msg.bodyPreview,
        (msg.from as Record<string, unknown> | undefined)?.address,
      ].filter(Boolean).join(" ").toLowerCase();

      const matchedKeywords = keywords.filter((kw) => searchText.includes(kw.toLowerCase()));
      if (matchedKeywords.length === 0) continue;

      matches.push({
        id: msg.id,
        subject: msg.subject,
        sender: (msg.from as Record<string, unknown> | undefined)?.address,
        receivedDateTime: msg.receivedDateTime,
        bodyPreview: (msg.bodyPreview as string ?? "").slice(0, 200),
        matchedKeywords,
      });
    }

    matches.sort((a, b) => {
      if (!a.receivedDateTime) return 1;
      if (!b.receivedDateTime) return -1;
      return new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime();
    });

    res.json({ matches, checkedCount: allMessages.length, checkTimestamp });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
