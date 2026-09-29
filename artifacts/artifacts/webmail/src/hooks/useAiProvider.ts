import { useState, useCallback } from "react";
import { apiUrl } from "@/lib/apiBase";

export type AiProvider = "openai" | "openrouter" | "anthropic" | "gemini";

export interface AiProviderConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

export interface AiModel {
  id: string;
  label: string;
}

const STORAGE_KEY = "ai_provider_config";

export const PROVIDER_INFO: Record<
  AiProvider,
  { label: string; url: string }
> = {
  openai: {
    label: "OpenAI",
    url: "https://platform.openai.com/api-keys",
  },
  openrouter: {
    label: "OpenRouter",
    url: "https://openrouter.ai/keys",
  },
  anthropic: {
    label: "Anthropic",
    url: "https://console.anthropic.com/keys",
  },
  gemini: {
    label: "Google Gemini",
    url: "https://aistudio.google.com/app/apikey",
  },
};

export async function fetchAiModels(provider: AiProvider, apiKey: string): Promise<AiModel[]> {
  const response = await fetch(apiUrl("/api/ai/models"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey }),
  });
  const data = await response.json().catch(() => ({})) as {
    models?: AiModel[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? `Could not load models (${response.status})`);
  }
  return Array.isArray(data.models)
    ? data.models.filter((model) => typeof model?.id === "string" && typeof model?.label === "string")
    : [];
}

function loadConfig(): AiProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AiProviderConfig;
  } catch {
    return null;
  }
}

function saveConfig(config: AiProviderConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function useAiProvider() {
  const [config, setConfigState] = useState<AiProviderConfig | null>(() => loadConfig());

  const setConfig = useCallback((next: AiProviderConfig) => {
    saveConfig(next);
    setConfigState(next);
  }, []);

  const clearConfig = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setConfigState(null);
  }, []);

  return {
    config,
    setConfig,
    clearConfig,
    hasConfig: config !== null && config.apiKey.trim().length > 0,
  };
}
