import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist/public");
const port = Number(process.env.PORT ?? 3000);
const apiOrigin = (process.env.API_ORIGIN ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const internalApiSecret =
  process.env.INTERNAL_API_SECRET?.trim() ||
  (process.env.NODE_ENV !== "production" ? process.env.SESSION_SECRET?.trim() : "");
const ssoLoginUrl = process.env.SSO_LOGIN_URL?.trim() || "";
const ssoLoginPath = normalizeLoginPath(process.env.SSO_LOGIN_PATH);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT ?? ""}"`);
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function normalizeLoginPath(value) {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error("SSO_LOGIN_PATH must be a relative path without query strings or traversal segments");
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
    ? candidate
    : null;
}

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyApi(req, res, requestUrl) {
  if (!internalApiSecret) {
    sendText(res, 503, "API proxy authentication is not configured");
    return;
  }

  const headers = {};
  for (const name of ["accept", "content-type", "cookie"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  headers["x-internal-api-secret"] = internalApiSecret;

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await readRequestBody(req);
  }

  const upstream = await fetch(`${apiOrigin}${requestUrl.pathname}${requestUrl.search}`, {
    method: req.method,
    headers,
    ...(body?.length ? { body } : {}),
    redirect: "manual",
  });

  const responseHeaders = {};
  for (const name of ["cache-control", "content-type", "location", "www-authenticate"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  const setCookies = upstream.headers.getSetCookie?.();
  if (setCookies?.length) responseHeaders["set-cookie"] = setCookies;

  const responseBody = await upstream.arrayBuffer();
  res.writeHead(upstream.status, responseHeaders);
  res.end(Buffer.from(responseBody));
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (requestUrl.pathname === "/healthz") {
    sendText(res, 200, JSON.stringify({ status: "ok" }), "application/json; charset=utf-8");
    return;
  }

  if (ssoLoginPath && requestUrl.pathname === ssoLoginPath) {
    if (!ssoLoginUrl) {
      sendText(res, 404, "Not Found");
      return;
    }
    res.writeHead(302, {
      "Cache-Control": "no-store",
      Location: ssoLoginUrl,
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
    if (!["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"].includes(req.method ?? "")) {
      sendText(res, 405, "Method Not Allowed");
      return;
    }
    try {
      await proxyApi(req, res, requestUrl);
    } catch (error) {
      console.error("API proxy request failed", error);
      sendText(res, 502, "API service unavailable");
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed");
    return;
  }

  const requestedPath = safePath(requestUrl.pathname);
  if (!requestedPath) {
    sendText(res, 400, "Bad Request");
    return;
  }

  let filePath = requestedPath;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) filePath = path.join(root, "index.html");
  } catch {
    filePath = path.join(root, "index.html");
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }

    res.writeHead(200, {
      "Cache-Control": filePath.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": stat.size,
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      createReadStream(filePath).pipe(res);
    }
  } catch {
    sendText(res, 500, "Internal Server Error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Webmail server listening on port ${port}`);
});

function shutdown(signal) {
  server.close((error) => {
    if (error) {
      console.error(`Failed to close webmail server after ${signal}`, error);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));