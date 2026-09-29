import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { ssoCodesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  getSessionUser,
  getSsoLoginPath,
  getSsoLoginUrl,
  SESSION_COOKIE,
  setSessionCookie,
  verifySsoAssertion,
} from "../lib/auth.js";

const router = Router();

function getAssertion(req: Request): string | null {
  const fromBody = (req.body as Record<string, unknown> | undefined)?.assertion;
  const fromQuery = req.query.assertion;
  const value = typeof fromBody === "string" ? fromBody : typeof fromQuery === "string" ? fromQuery : null;
  return value?.trim() || null;
}

async function resolveAssertion(req: Request): Promise<string | null> {
  const direct = getAssertion(req);
  if (direct) return direct;

  const code = typeof req.query.code === "string"
    ? req.query.code.trim()
    : typeof (req.body as Record<string, unknown> | undefined)?.code === "string"
      ? (req.body as Record<string, unknown>).code as string
      : null;

  if (!code) return null;

  const [row] = await db
    .select()
    .from(ssoCodesTable)
    .where(eq(ssoCodesTable.code, code));

  if (!row || row.expiresAt < new Date()) {
    if (row) await db.delete(ssoCodesTable).where(eq(ssoCodesTable.id, row.id));
    return null;
  }

  await db.delete(ssoCodesTable).where(eq(ssoCodesTable.id, row.id));
  return row.assertion;
}

function userResponse(user: ReturnType<typeof getSessionUser>) {
  return user
    ? {
        subject: user.subject,
        ...(user.email ? { email: user.email } : {}),
        ...(user.name ? { name: user.name } : {}),
      }
    : null;
}

router.get("/auth/config", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const loginPath = getSsoLoginPath();
  res.json({
    loginPath,
    loginUrl: loginPath ? null : getSsoLoginUrl(),
  });
});

router.get("/auth/session", (req: Request, res: Response) => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ authenticated: true, user: userResponse(user) });
});

router.post("/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
  res.status(204).send();
});

router.get("/auth/sso", async (req: Request, res: Response) => {
  const assertion = await resolveAssertion(req);
  const user = assertion ? verifySsoAssertion(assertion) : null;
  if (!user || !setSessionCookie(res, user)) {
    res.status(403).json({ error: "Invalid or unauthorized sign-in assertion" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.redirect(303, "/");
});

router.post("/auth/sso", async (req: Request, res: Response) => {
  const assertion = await resolveAssertion(req);
  const user = assertion ? verifySsoAssertion(assertion) : null;
  if (!user || !setSessionCookie(res, user)) {
    res.status(403).json({ error: "Invalid or unauthorized sign-in assertion" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ authenticated: true, user: userResponse(user) });
});

export default router;