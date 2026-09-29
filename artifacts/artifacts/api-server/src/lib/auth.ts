import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const SESSION_COOKIE = "webmail_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_REFRESH_THRESHOLD_SECONDS = SESSION_TTL_SECONDS / 2;
const ASSERTION_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_AUDIENCE = "outlook-webmail";

export interface AuthUser {
  subject: string;
  email?: string;
  name?: string;
}

interface SsoClaims {
  sub: string;
  email?: string;
  name?: string;
  aud: string | string[];
  exp: number;
  iat: number;
  iss?: string;
}

interface SessionClaims extends AuthUser {
  exp: number;
}

function configuredSecret(name: string, developmentFallback = false): string | null {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (developmentFallback && process.env.NODE_ENV !== "production") {
    return process.env.SESSION_SECRET?.trim() || null;
  }
  return null;
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function parseJsonSegment<T>(value: string): T | null {
  try {
    return JSON.parse(decodeBase64Url(value).toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = decodeBase64Url(left);
  const rightBuffer = decodeBase64Url(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value: string, secret: string): string {
  return encodeBase64Url(createHmac("sha256", secret).update(value).digest());
}

function hasAudience(audience: string | string[], expected: string): boolean {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

function matchesAllowedUser(user: AuthUser): boolean {
  const allowedSubject = process.env.SSO_ALLOWED_SUBJECT?.trim();
  const allowedEmail = process.env.SSO_ALLOWED_EMAIL?.trim().toLowerCase();

  if (allowedSubject && user.subject !== allowedSubject) return false;
  if (allowedEmail && user.email?.toLowerCase() !== allowedEmail) return false;
  return true;
}

function validateUserClaims(claims: Partial<AuthUser>): AuthUser | null {
  if (typeof claims.subject !== "string" || !claims.subject.trim()) return null;
  if (claims.email !== undefined && typeof claims.email !== "string") return null;
  if (claims.name !== undefined && typeof claims.name !== "string") return null;

  const user: AuthUser = {
    subject: claims.subject.trim(),
    ...(claims.email?.trim() ? { email: claims.email.trim() } : {}),
    ...(claims.name?.trim() ? { name: claims.name.trim() } : {}),
  };
  return matchesAllowedUser(user) ? user : null;
}

export function getConfiguredAudience(): string {
  return process.env.SSO_AUDIENCE?.trim() || DEFAULT_AUDIENCE;
}

export function getSsoLoginUrl(): string | null {
  return process.env.SSO_LOGIN_URL?.trim() || null;
}

export function getSsoLoginPath(): string | null {
  const value = process.env.SSO_LOGIN_PATH?.trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("?") || value.includes("#") || value.includes("\\") || value.includes("..")) return null;
  return value.replace(/\/+$/, "") || "/";
}

export function hasInternalApiSecret(): boolean {
  return Boolean(configuredSecret("INTERNAL_API_SECRET", true));
}

export function hasSsoConfiguration(): boolean {
  return Boolean(
    configuredSecret("SSO_SHARED_SECRET", true) &&
      (process.env.SSO_ALLOWED_SUBJECT?.trim() || process.env.SSO_ALLOWED_EMAIL?.trim()),
  );
}

export function isTrustedInternalRequest(req: Request): boolean {
  const secret = configuredSecret("INTERNAL_API_SECRET", true);
  const provided = req.header("x-internal-api-secret");
  if (!secret || !provided) return false;
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export function verifySsoAssertion(token: string): AuthUser | null {
  const secret = configuredSecret("SSO_SHARED_SECRET", true);
  if (!secret || token.length > 4096) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonSegment<{ alg?: string; typ?: string }>(encodedHeader);
  const claims = parseJsonSegment<SsoClaims>(encodedPayload);
  if (!header || !claims || header.alg !== "HS256" || header.typ !== "JWT") return null;
  if (!signaturesMatch(encodedSignature, sign(`${encodedHeader}.${encodedPayload}`, secret))) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= now) return null;
  if (!Number.isFinite(claims.iat) || claims.iat > now + ASSERTION_CLOCK_SKEW_SECONDS) return null;
  if (!hasAudience(claims.aud, getConfiguredAudience())) return null;
  const expectedIssuer = process.env.SSO_ISSUER?.trim();
  if (expectedIssuer && claims.iss !== expectedIssuer) return null;

  return validateUserClaims({
    subject: claims.sub,
    email: claims.email,
    name: claims.name,
  });
}

export function createSessionCookie(user: AuthUser): string | null {
  const secret = configuredSecret("SESSION_SECRET", true);
  if (!secret) return null;

  const payload: SessionClaims = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function getSessionUser(req: Request): AuthUser | null {
  const secret = configuredSecret("SESSION_SECRET", true);
  const value = req.cookies?.[SESSION_COOKIE];
  if (!secret || typeof value !== "string") return null;

  const [encodedPayload, encodedSignature] = value.split(".");
  if (!encodedPayload || !encodedSignature || !signaturesMatch(encodedSignature, sign(encodedPayload, secret))) {
    return null;
  }

  const claims = parseJsonSegment<SessionClaims>(encodedPayload);
  if (!claims || claims.exp <= Math.floor(Date.now() / 1000)) return null;

  const user = validateUserClaims(claims);
  if (!user) return null;

  if (claims.exp - Math.floor(Date.now() / 1000) < SESSION_REFRESH_THRESHOLD_SECONDS) {
    const refreshedCookie = createSessionCookie(user);
    if (refreshedCookie) {
      req.res?.cookie(SESSION_COOKIE, refreshedCookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: SESSION_TTL_SECONDS * 1000,
        path: "/",
      });
    }
  }

  return user;
}

export function setSessionCookie(res: Response, user: AuthUser): boolean {
  const value = createSessionCookie(user);
  if (!value) return false;

  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
  return true;
}