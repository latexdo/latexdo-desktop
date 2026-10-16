import React from "react";
import {
  Cloud,
  ExternalLink,
  Check,
  Loader2,
  AlertTriangle,
  KeyRound,
} from "lucide-react";
import type { CloudConfig } from "../features/ai/aiConfig";
import { cloudProviders, findCloudProvider } from "../features/ai/cloudProviders";
import { generateStepCloud, listCloudModels } from "../features/ai/aiCloud";
import {
  loadCloudCredential,
  removeCloudCredential,
  saveCloudCredential,
} from "../features/ai/cloudCredentials";

interface CloudProviderFormProps {
  cloud: CloudConfig;
  onChange: (cloud: CloudConfig) => void;
  onOpenExternal?: (url: string) => void;
}

export const CloudProviderForm: React.FC<CloudProviderFormProps> = ({
  cloud,
  onChange,
  onOpenExternal,
}) => {
  const preset = findCloudProvider(cloud.providerId);
  const [keyInput, setKeyInput] = React.useState("");
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "ok" | "error">(
    "idle",
  );
  const [saveMessage, setSaveMessage] = React.useState("");
  const [testState, setTestState] = React.useState<"idle" | "testing" | "ok" | "error">(
    "idle",
  );
  const [testMessage, setTestMessage] = React.useState("");
  // Models the provider offers this key, fetched live so the list never goes
  // stale; the catalog's suggestions fill in until it arrives.
  const [liveModels, setLiveModels] = React.useState<string[]>([]);

  const refreshModels = React.useCallback(
    async (apiKey?: string) => {
      const key = apiKey || (await loadCloudCredential(cloud.credentialId)) || "";
      if (!key) return;
      const models = await listCloudModels({
        vendor: cloud.vendor,
        baseUrl: cloud.baseUrl,
        apiKey: key,
      });
      setLiveModels(models);
    },
    [cloud.baseUrl, cloud.credentialId, cloud.vendor],
  );

  React.useEffect(() => {
    setLiveModels([]);
    if (cloud.credentialConfigured) void refreshModels();
  }, [cloud.credentialConfigured, refreshModels]);

  const modelSuggestions = React.useMemo(() => {
    const suggested = preset?.models ?? [];
    return [...suggested, ...liveModels.filter((model) => !suggested.includes(model))];
  }, [liveModels, preset?.models]);

  const selectProvider = (providerId: string) => {
    const next = findCloudProvider(providerId);
    if (!next) return;
    onChange({
      ...cloud,
      providerId,
      vendor: next.apiShape,
      baseUrl: next.baseUrl,
      model: next.defaultModel || cloud.model,
    });
    setTestState("idle");
  };

  const patch = (part: Partial<CloudConfig>) => {
    onChange({ ...cloud, ...part });
    setTestState("idle");
  };

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    setSaveState("saving");
    setSaveMessage("");
    const ok = await saveCloudCredential(cloud.credentialId, keyInput.trim());
    if (ok) {
      setSaveState("ok");
      setSaveMessage("Saved to the OS credential store.");
      void refreshModels(keyInput.trim());
      setKeyInput("");
      patch({ credentialConfigured: true });
    } else {
      setSaveState("error");
      setSaveMessage(
        "Secure credential storage is unavailable on this system; the key was not saved.",
      );
    }
  };

  const clearKey = async () => {
    await removeCloudCredential(cloud.credentialId);
    setKeyInput("");
    patch({ credentialConfigured: false });
    setSaveState("idle");
  };

  const testConnection = async () => {
    setTestState("testing");
    setTestMessage("");
    const apiKey =
      keyInput.trim() || (await loadCloudCredential(cloud.credentialId)) || "";
    if (!apiKey) {
      setTestState("error");
      setTestMessage("Enter an API key first.");
      return;
    }
    const step = await generateStepCloud(
      {
        requestId: "test",
        provider: "cloud",
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        tools: [],
        options: {
          cloudVendor: cloud.vendor,
          cloudBaseUrl: cloud.baseUrl,
          cloudModel: cloud.model,
          cloudApiKey: apiKey,
          maxTokens: 16,
          temperature: 0,
        },
      },
      () => {},
    );
    if (step.type === "error") {
      setTestState("error");
      setTestMessage(step.content);
    } else {
      setTestState("ok");
      setTestMessage(step.content.trim().slice(0, 80) || "Connected.");
      void refreshModels(apiKey);
    }
  };

  const showBaseUrl = preset?.custom || cloud.baseUrl.length > 0;

  return (
    <div className="cloud-form">
      <label className="cloud-form-field">
        <span>Provider</span>
        <select
          value={cloud.providerId}
          onChange={(e) => selectProvider(e.target.value)}
        >
          {cloudProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <div className="cloud-form-field">
        <span>API key</span>
        {cloud.credentialConfigured && !keyInput ? (
          <div className="cloud-form-saved">
            <KeyRound size={13} />
            <span>Stored in the OS credential store</span>
            <button type="button" className="cloud-form-link" onClick={clearKey}>
              Remove
            </button>
          </div>
        ) : (
          <div className="cloud-form-key-row">
            <input
              type="password"
              placeholder="Paste your API key"
              aria-label="API key"
              value={keyInput}
              autoComplete="off"
              onChange={(e) => {
                setKeyInput(e.target.value);
                setSaveState("idle");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveKey();
              }}
            />
            {keyInput && (
              <button
                type="button"
                className="ai-wizard-ghost"
                onClick={() => void saveKey()}
                disabled={saveState === "saving"}
              >
                {saveState === "saving" ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Check size={13} />
                )}
                Save
              </button>
            )}
          </div>
        )}
      </div>
      {saveState === "error" && (
        <span className="cloud-form-error">
          <AlertTriangle size={13} /> {saveMessage}
        </span>
      )}
      {saveState === "ok" && (
        <span className="cloud-form-ok">
          <Check size={13} /> {saveMessage}
        </span>
      )}
      {preset?.apiKeyUrl && (
        <button
          type="button"
          className="cloud-form-link"
          onClick={() => onOpenExternal?.(preset.apiKeyUrl)}
        >
          <ExternalLink size={12} /> Get a key from {preset.label}
        </button>
      )}

      <label className="cloud-form-field">
        <span>Model</span>
        <input
          type="text"
          list="cloud-model-suggestions"
          placeholder="Model id"
          value={cloud.model}
          onChange={(e) => patch({ model: e.target.value })}
        />
        <datalist id="cloud-model-suggestions">
          {modelSuggestions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>

      {showBaseUrl && (
        <label className="cloud-form-field">
          <span>Base URL{preset?.custom ? "" : " (optional)"}</span>
          <input
            type="text"
            placeholder="https://api.example.com/v1"
            value={cloud.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </label>
      )}

      <div className="cloud-form-test">
        <button
          type="button"
          className="ai-wizard-ghost"
          onClick={testConnection}
          disabled={
            (!cloud.credentialConfigured && !keyInput.trim()) || testState === "testing"
          }
        >
          {testState === "testing" ? (
            <>
              <Loader2 size={13} className="spin" /> Testing…
            </>
          ) : (
            <>
              <Cloud size={13} /> Test connection
            </>
          )}
        </button>
        {testState === "ok" && (
          <span className="cloud-form-ok">
            <Check size={13} /> {testMessage}
          </span>
        )}
        {testState === "error" && (
          <span className="cloud-form-error">
            <AlertTriangle size={13} /> {testMessage}
          </span>
        )}
      </div>
    </div>
  );
};
