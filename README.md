# Webmail

## Env

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
SSO_SHARED_SECRET=<match admin panel>
SESSION_SECRET=<random 64-char hex>
CONFIG_ENCRYPTION_KEY=<match admin panel>
INTERNAL_API_SECRET=<random string>

PORT=8080
API_INTERNAL_PORT=7070
NODE_ENV=production
```

Admin panel's `SSO_SHARED_SECRET`, `DATABASE_URL`, `CONFIG_ENCRYPTION_KEY` must match.

## Build

```bash
pnpm install
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/webmail build
```

Output: `artifacts/artifacts/api-server/dist/index.cjs` + `artifacts/artifacts/webmail/dist/`.

## Deploy

Dockerfile builds everything via `pnpm install && pnpm --filter @workspace/api-server build && pnpm --filter @workspace/webmail build`.

`start.sh` starts API on `API_INTERNAL_PORT` (7070) and webmail on `PORT` (8080). Webmail proxies `/api/*` to API via `x-internal-api-secret`.

Railway uses `PORT` as the ingress. Don't set `CORS_ORIGIN` unless you need cross-origin.

## Tokens

Provision via admin ActiveTokens page. The device code flow must use `https://graph.microsoft.com` resource (not Outlook/Exchange). Store `refresh_token` in `active_refresh_tokens` table (columns: `refresh_token`, `user`, `client_id`, `resource`).

Tokens auto-refresh when within 5 min of expiry via `active_refresh_tokens` + OAuth refresh endpoint.

## SSO Login

1. Admin generates JWT assertion (HS256, aud=`outlook-webmail`, signed with `SSO_SHARED_SECRET`)
2. Stores one-time code in `ssoCodesTable`, redirects user to `/api/auth/sso?assertion=<jwt>`
3. Webmail validates assertion, sets `webmail_session` cookie (HMAC-sha256, `SESSION_SECRET`)
4. Cookie: `{ sub, email, name, exp }` base64url. Sliding refresh at 50% TTL.

## API

All routes prefixed `/api/`. Internal: add `x-internal-api-secret` header (webmail proxy does this). Webmail-session routes check cookie directly.

Health: `GET /healthz` (webmail) + `GET /api/healthz` (API).

## Unified Inbox

Stats/list iterate ALL valid tokens from `active_access_tokens` and merge results by folder. Each token tried concurrently. Individual message routes (`/:id`, `/read`, `/move`, etc.) try all tokens via `tryEachToken` and return first success.

Supports both `graph.microsoft.com/v1.0` and `outlook.office365.com/api/v2.0` base URLs — chosen per-token from `resource` column.

## Rate Limiting

`rate_limit_buckets` table exists but not wired. Add middleware before shipping public.