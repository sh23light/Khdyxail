import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { activeAccessTokensTable, activeRefreshTokensTable } from "@workspace/db/schema";
import { gt, lte, and, or, sql, isNull } from "drizzle-orm";

const router = Router();

router.get("/tokens/emails", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const rows = await db
      .select({ user: activeAccessTokensTable.user })
      .from(activeAccessTokensTable)
      .where(
        or(
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
        ),
      );
    const unique = [...new Set(rows.map((r) => r.user).filter(Boolean))];
    res.json({ emails: unique });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch token emails" });
  }
});

export default router;