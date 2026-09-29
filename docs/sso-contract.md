# Webmail single-user SSO contract

Webmail does not provide signup or a local password login. The main
authentication server must authenticate the one permitted person and then
redirect them to Webmail with a short-lived signed JWT assertion.

## Deployment variables

Set these on the API and Webmail services as appropriate:

- `SSO_SHARED_SECRET`: same secret on the main auth server and this API.
- `SSO_ALLOWED_SUBJECT`: the one permitted user's stable subject identifier.
- `SSO_ALLOWED_EMAIL`: optional additional exact email restriction.
- `SSO_AUDIENCE`: defaults to `outlook-webmail`.
- `SSO_ISSUER`: optional exact issuer restriction.
- `SSO_LOGIN_URL`: the main auth server's login URL.
- `SSO_LOGIN_PATH`: optional relative path exposed by Webmail for the sign-in
  entry point, such as `/mysecretadminpath`. Configure the same value on the
  API and Webmail services. Webmail redirects this path to `SSO_LOGIN_URL`.
- `INTERNAL_API_SECRET`: same secret on the API and Webmail services. This
  prevents browsers from calling the API service directly.
- `API_ORIGIN`: the API service URL configured on the Webmail service.

Do not place any of these secrets in `VITE_*` variables or frontend code.

When `SSO_LOGIN_PATH` is configured, users visit:

```text
https://<webmail-host>/<configured-login-path>
```

For example, with `SSO_LOGIN_PATH=/mysecretadminpath`, the authorized entry
point is:

```text
https://<webmail-host>/mysecretadminpath
```

The path is not the authentication mechanism. A user still must authenticate
with the main auth server and receive a valid assertion for the configured
allowlisted identity.

## Assertion format

The main auth server signs a standard JWT with `HS256` using
`SSO_SHARED_SECRET`:

```json
{
  "sub": "the-one-allowed-user",
  "email": "admin@example.com",
  "name": "Admin",
  "aud": "outlook-webmail",
  "iat": 1760000000,
  "exp": 1760000060
}
```

The required claims are `sub`, `aud`, `iat`, and `exp`. `email` and `name` are
optional. The assertion should expire after roughly one minute.

After authenticating the user, the main auth server redirects to:

```text
https://<webmail-host>/api/auth/sso?assertion=<signed-jwt>
```

Webmail validates the signature, audience, expiry, optional issuer, and the
configured single-user allowlist. It then creates an HTTP-only session cookie
and redirects the user to the mailbox.

The API also accepts `POST /api/auth/sso` with
`{"assertion":"<signed-jwt>"}` for server-side integrations.