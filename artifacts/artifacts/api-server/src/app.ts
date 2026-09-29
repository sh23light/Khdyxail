import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getSessionUser, hasInternalApiSecret, isTrustedInternalRequest } from "./lib/auth";

const app: Express = express();
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAllOrigins = process.env.NODE_ENV !== "production" && allowedOrigins.length === 0;

app.set("trust proxy", 1);
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

app.use("/api", (req, res, next) => {
  if (req.path === "/healthz") {
    next();
    return;
  }

  if (!hasInternalApiSecret()) {
    res.status(503).json({ error: "Internal API authentication is not configured" });
    return;
  }

  if (!isTrustedInternalRequest(req)) {
    res.status(401).json({ error: "Internal service authentication required" });
    return;
  }

  if (req.path === "/auth/config" || req.path === "/auth/session" || req.path === "/auth/sso" || req.path === "/auth/logout") {
    next();
    return;
  }

  if (!getSessionUser(req)) {
    res.status(401).json({ error: "Webmail session required" });
    return;
  }

  next();
});

app.use("/api", router);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  logger.error({ err: error }, "Unhandled API error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
