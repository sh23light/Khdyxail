import { Router, type Request, type Response } from "express";
import {
  extractAiApiKey,
  extractAiProvider,
  listAiModels,
} from "../lib/ai.js";

function handleError(res: Response, error: unknown) {
  if (error instanceof Error && "status" in error) {
    const status = (error as { status: number }).status;
    res.status(status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}

const router = Router();

router.post("/ai/models", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const provider = extractAiProvider(body);
    const apiKey = extractAiApiKey(body, provider);
    const models = await listAiModels(provider, apiKey);
    res.json({ models });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;