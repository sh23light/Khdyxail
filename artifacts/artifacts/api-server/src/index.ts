import dns from "node:dns";
import net from "node:net";
import app from "./app";
import { logger } from "./lib/logger";

// graph.microsoft.com / outlook.office365.com resolve to both IPv4 and IPv6.
// Hosts without working outbound IPv6 (this machine, Railway containers) make
// Node's dual-stack "happy eyeballs" connect fail intermittently with
// ETIMEDOUT ("fetch failed"), which surfaced as empty mailboxes and
// "load error" in the reading pane. Connect over IPv4 only.
// Set PREFER_IPV6=1 to restore Node's default behaviour.
if (process.env["PREFER_IPV6"] !== "1") {
  dns.setDefaultResultOrder("ipv4first");
  net.setDefaultAutoSelectFamily(false);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

function shutdown(signal: string) {
  server.close((error) => {
    if (error) {
      logger.error({ err: error, signal }, "Error during server shutdown");
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
