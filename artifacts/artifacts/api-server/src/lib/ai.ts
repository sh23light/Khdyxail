import { fetchWithTimeout } from "./fetchWithTimeout.js";

export type AiProvider = "openai" | "openrouter" | "anthropic" | "gemini";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

export interface AiModel {
  id: string;
  label: string;
}

const AI_PROVIDERS: AiProvider[] = ["openai", "openrouter", "anthropic", "gemini"];
const MAX_MODELS = 1_000;

function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && AI_PROVIDERS.includes(value as AiProvider);
}

function modelLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isNonChatModel(id: string): boolean {
  return /(?:embedding|moderation|whisper|tts|dall-e|image|audio|transcri)/i.test(id);
}

async function fetchProviderJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`AI provider model request failed: ${response.status}`), {
      status: 502,
      body: text,
    });
  }
  return await response.json() as Record<string, unknown>;
}

function normalizeModels(
  rows: unknown,
  getModel: (row: Record<string, unknown>) => { id: unknown; label?: unknown; created?: unknown } | null,
): AiModel[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const model = getModel(row as Record<string, unknown>);
      if (!model || typeof model.id !== "string") return null;
      const id = model.id.trim();
      if (!id || id.length > 200 || isNonChatModel(id)) return null;
      return {
        id,
        label: modelLabel(model.label, id),
        created: typeof model.created === "number"
          ? model.created
          : typeof model.created === "string"
            ? Date.parse(model.created)
            : 0,
      };
    })
    .filter((model): model is AiModel & { created: number } => model !== null)
    .sort((a, b) => b.created - a.created || a.label.localeCompare(b.label))
    .slice(0, MAX_MODELS)
    .map(({ id, label }) => ({ id, label }));
}

export async function listAiModels(provider: AiProvider, apiKey: string): Promise<AiModel[]> {
  switch (provider) {
    case "openai": {
      const data = await fetchProviderJson("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return normalizeModels(data.data, (row) => ({
        id: row.id,
        label: row.id,
        created: row.created,
      }));
    }
    case "openrouter": {
      const data = await fetchProviderJson("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://outlook-webmail.replit.app",
        },
      });
      return normalizeModels(data.data, (row) => {
        const architecture = row.architecture as Record<string, unknown> | undefined;
        const inputModalities = architecture?.input_modalities;
        if (Array.isArray(inputModalities) && !inputModalities.includes("text")) return null;
        return {
          id: row.id,
          label: row.name ?? row.id,
          created: row.created,
        };
      });
    }
    case "anthropic": {
      const data = await fetchProviderJson("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      return normalizeModels(data.data, (row) => ({
        id: row.id,
        label: row.display_name ?? row.id,
        created: row.created_at,
      }));
    }
    case "gemini": {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const data = await fetchProviderJson(url, {});
      return normalizeModels(data.models, (row) => {
        const methods = row.supportedGenerationMethods;
        if (Array.isArray(methods) && !methods.includes("generateContent")) return null;
        const rawName = typeof row.name === "string" ? row.name : "";
        return {
          id: rawName.replace(/^models\//, ""),
          label: row.displayName ?? rawName,
        };
      });
    }
  }
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AiMessage[],
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const resp = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`AI API error: ${resp.status}`), { status: 502, body: text });
  }
  const data = await resp.json() as Record<string, unknown>;
  const content = (data.choices as Array<Record<string, Record<string, string>>>)?.[0]?.message?.content;
  if (!content) throw Object.assign(new Error("AI returned empty response"), { status: 502 });
  return content;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: AiMessage[],
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs = messages.filter((m) => m.role !== "system");

  const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemMsg?.content ?? "",
      messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`Anthropic API error: ${resp.status}`), { status: 502, body: text });
  }
  const data = await resp.json() as Record<string, unknown>;
  const block = (data.content as Array<Record<string, string>>)?.[0];
  if (!block?.text) throw Object.assign(new Error("Anthropic returned empty response"), { status: 502 });
  const raw = block.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : raw;
}

async function callGemini(
  apiKey: string,
  model: string,
  messages: AiMessage[],
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs = messages.filter((m) => m.role !== "system");

  const geminiModel = model.startsWith("models/") ? model : `models/${model}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${geminiModel}:generateContent?key=${apiKey}`;

  const contents = userMsgs.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { responseMimeType: "application/json" },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`Gemini API error: ${resp.status}`), { status: 502, body: text });
  }
  const data = await resp.json() as Record<string, unknown>;
  const text = (data.candidates as Array<Record<string, unknown>>)?.[0]?.content as Record<string, unknown> | undefined;
  const part = (text?.parts as Array<Record<string, string>>)?.[0]?.text;
  if (!part) throw Object.assign(new Error("Gemini returned empty response"), { status: 502 });
  return part;
}

export async function callAi(
  config: AiConfig,
  messages: AiMessage[],
): Promise<Record<string, unknown>> {
  if (messages.length === 0 || messages.some((message) => message.content.length > 16_000)) {
    throw Object.assign(new Error("AI message content exceeds the allowed limit"), { status: 400 });
  }
  if (messages.reduce((total, message) => total + message.content.length, 0) > 32_000) {
    throw Object.assign(new Error("AI request is too large"), { status: 400 });
  }

  let raw: string;

  switch (config.provider) {
    case "openai":
      raw = await callOpenAiCompatible(
        "https://api.openai.com/v1",
        config.apiKey,
        config.model,
        messages,
      );
      break;
    case "openrouter":
      raw = await callOpenAiCompatible(
        "https://openrouter.ai/api/v1",
        config.apiKey,
        config.model,
        messages,
        { "HTTP-Referer": "https://outlook-webmail.replit.app" },
      );
      break;
    case "anthropic":
      raw = await callAnthropic(config.apiKey, config.model, messages);
      break;
    case "gemini":
      raw = await callGemini(config.apiKey, config.model, messages);
      break;
    default:
      throw Object.assign(new Error(`Unknown provider: ${config.provider}`), { status: 400 });
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("AI returned invalid JSON"), { status: 502 });
  }
}

export function extractAiConfig(body: Record<string, unknown>): AiConfig {
  const provider = extractAiProvider(body);
  const modelValue = body.model ?? "gpt-4o-mini";
  if (typeof modelValue !== "string" || modelValue.trim().length === 0 || modelValue.length > 200) {
    throw Object.assign(new Error("AI model must be a non-empty string of at most 200 characters"), { status: 400 });
  }
  const model = modelValue.trim();
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    throw Object.assign(new Error("AI model contains invalid characters"), { status: 400 });
  }

  return { provider, model, apiKey: extractAiApiKey(body, provider) };
}

export function extractAiProvider(body: Record<string, unknown>): AiProvider {
  const providerValue = body.provider ?? "openai";
  if (!isAiProvider(providerValue)) {
    throw Object.assign(new Error("Unsupported AI provider"), { status: 400 });
  }
  return providerValue;
}

export function extractAiApiKey(body: Record<string, unknown>, provider: AiProvider): string {
  let apiKey: string | undefined;
  if (body.apiKey && typeof body.apiKey === "string" && body.apiKey.trim()) {
    if (body.apiKey.length > 512) {
      throw Object.assign(new Error("AI API key is too long"), { status: 400 });
    }
    apiKey = body.apiKey.trim();
  } else if (provider === "openai") {
    apiKey = process.env.OPENAI_API_KEY;
  }

  if (!apiKey) {
    throw Object.assign(
      new Error("No API key provided. Configure an AI provider in settings or set OPENAI_API_KEY on the server."),
      { status: 400 },
    );
  }

  return apiKey;
}

export function extractSystemPrompt(body: Record<string, unknown>): string {
  const value = body.systemPrompt;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error("systemPrompt is required. Set your system prompt before running analysis."), {
      status: 400,
    });
  }
  if (value.length > 12_000) {
    throw Object.assign(new Error("systemPrompt must be at most 12,000 characters"), { status: 400 });
  }
  return value.trim();
}
