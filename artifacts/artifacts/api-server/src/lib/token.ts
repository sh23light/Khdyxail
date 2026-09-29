import { db } from "@workspace/db";
import { activeAccessTokensTable, activeRefreshTokensTable } from "@workspace/db/schema";
import { gt, eq, sql, isNull, and, or, lte, desc } from "drizzle-orm";
import type { Request } from "express";
import { getSessionUser } from "./auth";
import { decryptConfigValue } from "@workspace/db/secure-config";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

/** Refresh a little before expiry so a request never starts with a token that dies mid-flight. */
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/** Tenant ID Microsoft uses for all personal (MSA / outlook.com / live.com) accounts. */
const MSA_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

export type TokenWithBase = { token: string; baseUrl: string; user: string };

const RESOURCE_TO_BASE_URL: Record<string, string> = {
  "https://graph.microsoft.com": "https://graph.microsoft.com/v1.0",
  "https://outlook.office365.com": "https://outlook.office365.com/api/v2.0",
  "https://outlook.office.com": "https://outlook.office.com/api/v2.0",
};

function normalizeResource(resource: string | null | undefined): string {
  return (resource ?? "https://graph.microsoft.com").replace(/\/+$/, "");
}

function resourceToBaseUrl(resource: string): string {
  return RESOURCE_TO_BASE_URL[normalizeResource(resource)] ?? "https://graph.microsoft.com/v1.0";
}

function safeDecrypt(value: string | null | undefined, label: string): string | null {
  if (!value) return null;
  try {
    return decryptConfigValue(value);
  } catch (err) {
    console.error(`[Token] Decrypt failed for ${label}:`, (err as Error).message);
    return null;
  }
}

/**
 * Pick the token endpoint tenant from the access token's `tid` claim.
 * `common` fails for single-tenant app registrations, and personal accounts
 * must use `consumers`. Opaque (non-JWT) tokens fall back to `common`.
 */
function tenantFromAccessToken(accessToken: string | null): string {
  if (!accessToken) return "common";
  const parts = accessToken.split(".");
  if (parts.length !== 3) return "common";
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { tid?: string };
    if (!payload.tid) return "common";
    return payload.tid === MSA_TENANT_ID ? "consumers" : payload.tid;
  } catch {
    return "common";
  }
}

type RefreshResult = { accessToken: string; expiresIn: number; newRefreshToken: string };

async function refreshGraphToken(
  refreshToken: string,
  clientId: string,
  resource: string,
  tenant: string,
): Promise<RefreshResult | null> {
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    // Without an explicit scope the v2 endpoint issues a Graph token, which is
    // rejected by outlook.office365.com and vice versa. Ask for the same audience.
    scope: `${normalizeResource(resource)}/.default offline_access`,
  });
  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, 10_000);
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[Token] Refresh failed clientId=${clientId} tenant=${tenant}: ${resp.status} ${text.slice(0, 300)}`);
      return null;
    }
    const data = (await resp.json()) as Record<string, unknown>;
    if (typeof data.access_token !== "string") {
      console.error(`[Token] Refresh response had no access_token clientId=${clientId}`);
      return null;
    }
    return {
      accessToken: data.access_token,
      expiresIn: Number(data.expires_in) || 3600,
      newRefreshToken: (data.refresh_token as string) ?? refreshToken,
    };
  } catch (err) {
    console.error(`[Token] Refresh error clientId=${clientId}:`, (err as Error).message);
    return null;
  }
}

/**
 * One page load fires stats + list + message requests at the same time. Without
 * this, each of them would refresh the same token in parallel and race each
 * other writing rotated refresh tokens back to the DB.
 */
const inflightRefresh = new Map<number, Promise<string | null>>();

type AccessRow = typeof activeAccessTokensTable.$inferSelect;

async function refreshRow(row: AccessRow, now: Date): Promise<string | null> {
  const [refreshRowRec] = await db
    .select()
    .from(activeRefreshTokensTable)
    .where(
      and(
        eq(activeRefreshTokensTable.user, row.user),
        eq(activeRefreshTokensTable.clientId, row.clientId),
        isNull(activeRefreshTokensTable.invalidatedAt),
        or(
          isNull(activeRefreshTokensTable.refreshTokenExpiresAt),
          gt(activeRefreshTokensTable.refreshTokenExpiresAt, now),
        ),
      ),
    )
    .orderBy(desc(activeRefreshTokensTable.storedAt))
    .limit(1);

  // The admin panel stores refresh tokens encrypted (enc:v1:...), same as access tokens.
  const refreshToken = safeDecrypt(refreshRowRec?.refreshToken, `refresh id=${refreshRowRec?.id}`);
  if (!refreshRowRec || !refreshToken) return null;

  const tenant = tenantFromAccessToken(safeDecrypt(row.accessToken, `access id=${row.id}`));
  const refreshed = await refreshGraphToken(refreshToken, row.clientId, row.resource, tenant);
  if (!refreshed) return null;

  const nowMs = Date.now();
  const newExpires = new Date(nowMs + refreshed.expiresIn * 1000);
  await db
    .update(activeAccessTokensTable)
    .set({ accessToken: refreshed.accessToken, issued: new Date(nowMs), expires: newExpires })
    .where(eq(activeAccessTokensTable.id, row.id));
  await db
    .update(activeRefreshTokensTable)
    .set({
      refreshToken: refreshed.newRefreshToken,
      lastRefreshedAt: new Date(nowMs),
      nextRefreshAt: new Date(nowMs + Math.max(60, refreshed.expiresIn - 300) * 1000),
    })
    .where(eq(activeRefreshTokensTable.id, refreshRowRec.id));
  console.log(`[Token] Refreshed user=${row.user} access id=${row.id} expires=${newExpires.toISOString()}`);
  return refreshed.accessToken;
}

function refreshRowOnce(row: AccessRow, now: Date): Promise<string | null> {
  const existing = inflightRefresh.get(row.id);
  if (existing) return existing;
  const p = refreshRow(row, now)
    .catch((err) => {
      console.error(`[Token] Refresh crashed for id=${row.id}:`, (err as Error).message);
      return null;
    })
    .finally(() => inflightRefresh.delete(row.id));
  inflightRefresh.set(row.id, p);
  return p;
}

function usableCondition(now: Date) {
  return or(
    gt(activeAccessTokensTable.expires, now),
    and(
      lte(activeAccessTokensTable.expires, now),
      sql`EXISTS (SELECT 1 FROM active_refresh_tokens
        WHERE active_refresh_tokens.user = ${activeAccessTokensTable.user}
        AND active_refresh_tokens.client_id = ${activeAccessTokensTable.clientId}
        AND active_refresh_tokens.invalidated_at IS NULL
        AND (active_refresh_tokens.refresh_token_expires_at IS NULL
          OR active_refresh_tokens.refresh_token_expires_at > ${now}))`,
    ),
  );
}

/**
 * Returns usable tokens. With `upn`, only that mailbox (case-insensitive);
 * otherwise every provisioned mailbox (unified inbox).
 */
export async function getAccessTokens(req: Request, upn?: string): Promise<TokenWithBase[]> {
  const user = getSessionUser(req);
  if (!user?.email) {
    console.warn(`[Token] No session email for request ${req.path}`);
    return [];
  }

  const now = new Date();
  const mailbox = upn?.trim();

  const where = mailbox
    ? and(sql`lower(${activeAccessTokensTable.user}) = lower(${mailbox})`, usableCondition(now))
    : usableCondition(now);

  const allRows = await db
    .select()
    .from(activeAccessTokensTable)
    .where(where)
    // Newest first, so the de-dupe below keeps the freshest token per mailbox/client.
    .orderBy(desc(activeAccessTokensTable.expires));

  const seen = new Set<string>();
  const rows = allRows.filter((row) => {
    const key = `${row.user.toLowerCase()}|${row.clientId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (rows.length === 0) {
    console.warn(`[Token] No usable tokens for session=${user.email} upn=${mailbox ?? "any"}`);
    return [];
  }

  const resolved = await Promise.all(
    rows.map(async (row): Promise<TokenWithBase | null> => {
      const expiresMs = new Date(row.expires).getTime();
      const needsRefresh = expiresMs - now.getTime() < TOKEN_REFRESH_THRESHOLD_MS;

      if (needsRefresh) {
        const fresh = await refreshRowOnce(row, now);
        if (fresh) return { token: fresh, baseUrl: resourceToBaseUrl(row.resource), user: row.user };
        if (expiresMs <= Date.now()) {
          // Sending an expired token only produces a Graph 401 that looks like a
          // "token issue" in the UI. Skip it and let other mailboxes answer.
          console.warn(`[Token] Skipping expired token id=${row.id} user=${row.user}: refresh failed`);
          return null;
        }
      }

      const token = safeDecrypt(row.accessToken, `access id=${row.id}`);
      return token ? { token, baseUrl: resourceToBaseUrl(row.resource), user: row.user } : null;
    }),
  );

  return resolved.filter((t): t is TokenWithBase => t !== null);
}

export async function getAccessToken(req: Request): Promise<TokenWithBase | null> {
  const tokens = await getAccessTokens(req);
  return tokens[0] ?? null;
}
