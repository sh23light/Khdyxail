import { db } from "@workspace/db";
import { activeAccessTokensTable, activeRefreshTokensTable } from "@workspace/db/schema";
import { gt, eq, sql, isNull, and, or, lte } from "drizzle-orm";
import type { Request } from "express";
import { getSessionUser } from "./auth";
import { decryptConfigValue } from "@workspace/db/secure-config";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

async function refreshGraphToken(
  refreshToken: string,
  clientId: string,
  tenant = "common",
): Promise<{ accessToken: string; expiresIn: number; newRefreshToken: string } | null> {
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, 10_000);
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[Token] Refresh failed for clientId=${clientId}: ${resp.status} ${text}`);
      return null;
    }
    const data = (await resp.json()) as Record<string, unknown>;
    console.log(`[Token] Refreshed token for clientId=${clientId}`);
    return {
      accessToken: data.access_token as string,
      expiresIn: (data.expires_in as number) ?? 3600,
      newRefreshToken: (data.refresh_token as string) ?? refreshToken,
    };
  } catch (err) {
    console.error(`[Token] Refresh error for clientId=${clientId}:`, (err as Error).message);
    return null;
  }
}

export type TokenWithBase = { token: string; baseUrl: string };

const RESOURCE_TO_BASE_URL: Record<string, string> = {
  "https://graph.microsoft.com": "https://graph.microsoft.com/v1.0",
  "https://outlook.office365.com": "https://outlook.office365.com/api/v2.0",
  "https://outlook.office.com": "https://outlook.office.com/api/v2.0",
};

function resourceToBaseUrl(resource: string): string {
  return RESOURCE_TO_BASE_URL[resource] ?? "https://graph.microsoft.com/v1.0";
}

export async function getAccessTokens(req: Request, upn?: string): Promise<TokenWithBase[]> {
  const user = getSessionUser(req);
  if (!user?.email) {
    console.warn(`[Token] No session email for request ${req.path}`);
    return [];
  }

  const dbNow = new Date();
  const dbNowMs = dbNow.getTime();

  let rows;
  if (upn) {
    rows = await db
      .select()
      .from(activeAccessTokensTable)
      .where(
        and(
          eq(activeAccessTokensTable.user, upn),
          or(
            gt(activeAccessTokensTable.expires, dbNow),
            and(
              lte(activeAccessTokensTable.expires, dbNow),
              sql`EXISTS (SELECT 1 FROM active_refresh_tokens
                WHERE active_refresh_tokens.user = ${activeAccessTokensTable.user}
                AND active_refresh_tokens.client_id = ${activeAccessTokensTable.clientId}
                AND active_refresh_tokens.invalidated_at IS NULL
                AND (active_refresh_tokens.refresh_token_expires_at IS NULL
                  OR active_refresh_tokens.refresh_token_expires_at > ${dbNow}))`,
            ),
          ),
        ),
      )
      .limit(1);
  } else {
    rows = await db
      .select()
      .from(activeAccessTokensTable)
      .where(
        or(
          gt(activeAccessTokensTable.expires, dbNow),
          and(
            lte(activeAccessTokensTable.expires, dbNow),
            sql`EXISTS (SELECT 1 FROM active_refresh_tokens
              WHERE active_refresh_tokens.user = ${activeAccessTokensTable.user}
              AND active_refresh_tokens.client_id = ${activeAccessTokensTable.clientId}
              AND active_refresh_tokens.invalidated_at IS NULL
              AND (active_refresh_tokens.refresh_token_expires_at IS NULL
                OR active_refresh_tokens.refresh_token_expires_at > ${dbNow}))`,
          ),
        ),
      );
  }

  const seen = new Set<string>();
  rows = rows.filter(row => {
    const key = `${row.user}|${row.clientId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (rows.length === 0) {
    console.warn(`[Token] No valid tokens found for user=${user.email} upn=${upn ?? "any"}`);
    return [];
  }

  const result: TokenWithBase[] = [];
  for (const row of rows) {
    if (row?.accessToken) {
      if (new Date(row.expires).getTime() - dbNowMs < TOKEN_REFRESH_THRESHOLD_MS) {
        const [refreshRow] = await db
          .select()
          .from(activeRefreshTokensTable)
          .where(
            and(
              eq(activeRefreshTokensTable.user, row.user),
              eq(activeRefreshTokensTable.clientId, row.clientId),
              isNull(activeRefreshTokensTable.invalidatedAt),
              or(
                isNull(activeRefreshTokensTable.refreshTokenExpiresAt),
                gt(activeRefreshTokensTable.refreshTokenExpiresAt, dbNow),
              ),
            ),
          )
          .limit(1);
        if (refreshRow?.refreshToken) {
          const refreshed = await refreshGraphToken(refreshRow.refreshToken, row.clientId);
          if (refreshed) {
            const newExpires = new Date(dbNowMs + refreshed.expiresIn * 1000);
            await db
              .update(activeAccessTokensTable)
              .set({
                accessToken: refreshed.accessToken,
                expires: newExpires,
              })
              .where(eq(activeAccessTokensTable.id, row.id));
            await db
              .update(activeRefreshTokensTable)
              .set({
                refreshToken: refreshed.newRefreshToken,
                lastRefreshedAt: dbNow,
                nextRefreshAt: new Date(dbNowMs + refreshed.expiresIn * 1000),
              })
              .where(eq(activeRefreshTokensTable.id, refreshRow.id));
            console.log(`[Token] Refreshed + updated token id=${row.id}, refresh id=${refreshRow.id}`);
            result.push({ token: refreshed.accessToken, baseUrl: resourceToBaseUrl(row.resource) });
            continue;
          }
          console.warn(`[Token] Refresh failed for token id=${row.id}, falling back to stored token`);
        }
      }
      try {
        result.push({ token: decryptConfigValue(row.accessToken), baseUrl: resourceToBaseUrl(row.resource) });
      } catch (err) {
        console.error(`[Token] Decrypt failed for id=${row.id}:`, (err as Error).message);
      }
    }
  }
  return result;
}

export async function getAccessToken(req: Request): Promise<TokenWithBase | null> {
  const tokens = await getAccessTokens(req);
  return tokens[0] ?? null;
}