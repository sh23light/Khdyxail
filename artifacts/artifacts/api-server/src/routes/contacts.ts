import { Router, type Request, type Response } from "express";
import {
  ListContactsQueryParams,
  CreateContactBody,
} from "@workspace/api-zod";
import { getAccessToken } from "../lib/token.js";
import { fetchWithTimeout } from "../lib/fetchWithTimeout.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphGet(token: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const resp = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`Graph API error: ${resp.status}`), { status: resp.status, body: text });
  }
  return resp.json() as Promise<unknown>;
}

async function graphPost(token: string, path: string, body: unknown) {
  const resp = await fetchWithTimeout(`${GRAPH_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`Graph API error: ${resp.status}`), { status: resp.status, body: text });
  }
  return resp.json() as Promise<unknown>;
}

function handleError(res: Response, err: unknown) {
  if (err instanceof Error && "status" in err) {
    const status = (err as { status: number }).status;
    res.status(status).json({ error: err.message });
  } else {
    res.status(500).json({ error: "Internal server error" });
  }
}

function mapContact(c: Record<string, unknown>) {
  const emails = ((c.emailAddresses as Array<Record<string, string>> | null) ?? []).map((e) => ({
    name: e.name ?? null,
    address: e.address ?? "",
  }));
  const phones = (c.businessPhones as string[] | null) ?? (c.homePhones as string[] | null) ?? [];
  return {
    id: c.id as string,
    displayName: (c.displayName as string) ?? "",
    emailAddresses: emails,
    phone: phones[0] ?? (c.mobilePhone as string | null) ?? null,
    company: (c.companyName as string | null) ?? null,
    jobTitle: (c.jobTitle as string | null) ?? null,
  };
}

const router = Router();

router.get("/contacts", async (req: Request, res: Response) => {
  const token = await getAccessToken(req);
  if (!token) { res.status(401).json({ error: "No access token" }); return; }

  const parsed = ListContactsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query params" }); return; }

  const { search, top = 50 } = parsed.data;

  try {
    const params: Record<string, string> = {
      "$select": "id,displayName,emailAddresses,businessPhones,homePhones,mobilePhone,companyName,jobTitle",
      "$top": String(top),
      "$orderby": "displayName asc",
    };
    if (search) params["$search"] = `"${search}"`;

    const data = await graphGet(token, "/me/contacts", params) as Record<string, unknown>;
    const contacts = (data.value as Array<Record<string, unknown>> ?? []).map(mapContact);
    res.json({ contacts, total: contacts.length });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/contacts", async (req: Request, res: Response) => {
  const token = await getAccessToken(req);
  if (!token) { res.status(401).json({ error: "No access token" }); return; }

  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { displayName, emailAddresses, phone, company, jobTitle } = parsed.data;

  try {
    const data = await graphPost(token, "/me/contacts", {
      displayName,
      emailAddresses: emailAddresses.map((e) => ({ address: e.address, name: e.name ?? "" })),
      ...(phone ? { businessPhones: [phone] } : {}),
      ...(company ? { companyName: company } : {}),
      ...(jobTitle ? { jobTitle } : {}),
    }) as Record<string, unknown>;
    res.status(201).json(mapContact(data));
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
