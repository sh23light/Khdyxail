import { useState, useCallback } from "react";

const STORAGE_KEY = "webmail:ai-system-prompt";

export function useAiSystemPrompt() {
  const [prompt, setPromptState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const setPrompt = useCallback((value: string) => {
    setPromptState(value);
    try {
      if (value.trim()) {
        localStorage.setItem(STORAGE_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const clearPrompt = useCallback(() => {
    setPromptState("");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  return { prompt, setPrompt, clearPrompt, hasPrompt: prompt.trim().length > 0 };
}
