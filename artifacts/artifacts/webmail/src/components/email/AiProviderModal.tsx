import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Eye, EyeOff, Check, CheckCircle2, Trash2, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AiProvider,
  type AiProviderConfig,
  type AiModel,
  fetchAiModels,
  PROVIDER_INFO,
  useAiProvider,
} from "@/hooks/useAiProvider";

interface AiProviderModalProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDERS: AiProvider[] = ["openai", "openrouter", "anthropic", "gemini"];

export default function AiProviderModal({ open, onClose }: AiProviderModalProps) {
  const { config, setConfig, clearConfig } = useAiProvider();

  const [provider, setProvider] = useState<AiProvider>(config?.provider ?? "openrouter");
  const [model, setModel] = useState(config?.model ?? "");
  const [apiKey, setApiKey] = useState(config?.apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProvider(config?.provider ?? "openrouter");
      setModel(config?.model ?? "");
      setApiKey(config?.apiKey ?? "");
      setShowKey(false);
      setSaved(false);
      setModels([]);
      setModelsError(null);
    }
  }, [open, config]);

  const info = PROVIDER_INFO[provider];
  const defaultModel = models[0]?.id ?? "";
  const selectedModel = models.some((item) => item.id === model) ? model : "";
  const resolvedModel = model || defaultModel;

  const loadModels = useCallback(async (providerToLoad = provider, apiKeyToLoad = apiKey) => {
    if (!apiKeyToLoad.trim()) {
      setModels([]);
      setModelsError("Enter an API key to load models.");
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const nextModels = await fetchAiModels(providerToLoad, apiKeyToLoad.trim());
      setModels(nextModels);
      if (nextModels.length === 0) {
        setModelsError("No compatible chat models were returned. You can enter a model ID below.");
      }
    } catch (error) {
      setModels([]);
      setModelsError(error instanceof Error ? error.message : "Could not load models.");
    } finally {
      setModelsLoading(false);
    }
  }, [apiKey, provider]);

  useEffect(() => {
    if (open && config?.apiKey && config.provider === provider) {
      void loadModels(config.provider, config.apiKey);
    }
  }, [open]); // Load saved credentials once when the dialog opens.

  const handleProviderChange = (p: AiProvider) => {
    setProvider(p);
    setModel("");
    setModels([]);
    setModelsError(null);
    if (apiKey.trim()) void loadModels(p, apiKey);
  };

  const handleSave = () => {
    if (!apiKey.trim()) return;
    const next: AiProviderConfig = {
      provider,
      model: resolvedModel,
      apiKey: apiKey.trim(),
    };
    setConfig(next);
    setSaved(true);
    setTimeout(() => {
      onClose();
      setSaved(false);
    }, 800);
  };

  const handleClear = () => {
    clearConfig();
    setApiKey("");
    setModel("");
    setProvider("openrouter");
      setModels([]);
      setModelsError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Bot className="w-4 h-4 text-primary" />
            AI Provider Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your API key is stored locally in your browser and sent through this app's API proxy only when loading models or running analysis. It is not persisted on the server.
          </p>

          {/* Provider selector */}
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => handleProviderChange(p)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors text-left",
                  provider === p
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-foreground/70 hover:border-border/80 hover:bg-muted/40"
                )}
              >
                <span className="flex-1 truncate">{PROVIDER_INFO[p].label}</span>
                {provider === p && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
              </button>
            ))}
          </div>

          {/* Model selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Model</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => void loadModels()}
                disabled={!apiKey.trim() || modelsLoading}
              >
                {modelsLoading ? "Loading…" : "Refresh models"}
              </Button>
            </div>
            <div
              className={cn(
                "rounded-md border bg-background",
                (modelsLoading || models.length === 0) && "opacity-70",
              )}
              role="listbox"
              aria-label={`${info.label} models`}
              aria-busy={modelsLoading}
            >
              {modelsLoading ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Loading provider models…
                </p>
              ) : models.length > 0 ? (
                <div className="max-h-48 overflow-y-auto p-1">
                  {models.map((m) => {
                    const isSelected = selectedModel === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => setModel(m.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                          isSelected && "bg-accent text-accent-foreground",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{m.label}</span>
                        {isSelected && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Load models from the provider to choose one.
                </p>
              )}
            </div>
            {modelsError && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">{modelsError}</p>
            )}
          </div>

          {/* Custom model input */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Or type a custom model ID
            </Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={defaultModel || "e.g. provider/model-id"}
              className="h-9 text-sm font-mono"
            />
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">API Key</Label>
              <a
                href={info.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
              >
                Get a key
                <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
              </a>
            </div>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Your ${info.label} API key`}
                className="h-9 text-sm pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
              onClick={handleClear}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleSave}
                disabled={!apiKey.trim() || saved}
              >
                {saved ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Saved!
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
