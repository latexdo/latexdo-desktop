import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig } from "../features/ai/aiConfig";
import type { CloudConfig } from "../features/ai/aiConfig";

const cloudMock = vi.hoisted(() => ({
  generateStepCloud: vi.fn(),
}));

const credentialMock = vi.hoisted(() => ({
  saveCredential: vi.fn(),
  loadCredential: vi.fn(),
  removeCredential: vi.fn(),
}));

vi.mock("../features/ai/aiCloud", () => ({
  generateStepCloud: cloudMock.generateStepCloud,
  listCloudModels: async () => [],
}));

vi.mock("../features/ai/cloudCredentials", () => ({
  saveCloudCredential: credentialMock.saveCredential,
  loadCloudCredential: credentialMock.loadCredential,
  removeCloudCredential: credentialMock.removeCredential,
}));

import { CloudProviderForm } from "./CloudProviderForm";

function cloud(overrides: Partial<CloudConfig> = {}): CloudConfig {
  return {
    ...defaultAiConfig.cloud,
    credentialConfigured: true,
    ...overrides,
  };
}

describe("CloudProviderForm", () => {
  beforeEach(() => {
    cloudMock.generateStepCloud.mockReset();
    cloudMock.generateStepCloud.mockResolvedValue({
      type: "text",
      content: " ok\n",
    });
    credentialMock.saveCredential.mockReset();
    credentialMock.saveCredential.mockResolvedValue(true);
    credentialMock.loadCredential.mockReset();
    credentialMock.loadCredential.mockResolvedValue("sk-test");
    credentialMock.removeCredential.mockReset();
    credentialMock.removeCredential.mockResolvedValue(undefined);
  });

  it("selects provider presets and opens provider key pages", () => {
    const onChange = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <CloudProviderForm
        cloud={cloud()}
        onChange={onChange}
        onOpenExternal={onOpenExternal}
      />,
    );

    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "gemini" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "gemini",
        vendor: "openai",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-2.0-flash",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Get a key from/i }));
    expect(onOpenExternal).toHaveBeenCalledWith(
      "https://console.anthropic.com/settings/keys",
    );
  });

  it("stores a new key via the credential vault when saved", async () => {
    const onChange = vi.fn();
    render(
      <CloudProviderForm
        cloud={cloud({ credentialConfigured: false })}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Paste your API key"), {
      target: { value: "sk-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(credentialMock.saveCredential).toHaveBeenCalledWith(
        "credential-anthropic-primary",
        "sk-new",
      );
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentialConfigured: true }),
    );
  });

  it("signals a clear error when secure storage is unavailable", async () => {
    credentialMock.saveCredential.mockResolvedValue(false);
    const onChange = vi.fn();
    render(
      <CloudProviderForm
        cloud={cloud({ credentialConfigured: false })}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Paste your API key"), {
      target: { value: "sk-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    expect(
      await screen.findByText(/Secure credential storage is unavailable/i),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a stored key and clears configuration", async () => {
    const onChange = vi.fn();
    render(<CloudProviderForm cloud={cloud()} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Remove/i }));

    await waitFor(() => {
      expect(credentialMock.removeCredential).toHaveBeenCalledWith(
        "credential-anthropic-primary",
      );
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentialConfigured: false }),
    );
  });

  it("patches editable fields and shows custom base URLs", () => {
    const onChange = vi.fn();
    render(
      <CloudProviderForm
        cloud={cloud({
          providerId: "custom",
          vendor: "openai",
          baseUrl: "http://localhost:4000/v1",
          model: "local-model",
          credentialConfigured: false,
        })}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Model id"), {
      target: { value: "other-model" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "other-model" }),
    );

    fireEvent.change(screen.getByPlaceholderText("https://api.example.com/v1"), {
      target: { value: "http://localhost:5000/v1" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:5000/v1" }),
    );
  });

  it("tests a cloud connection and reports success", async () => {
    render(<CloudProviderForm cloud={cloud()} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));

    await waitFor(() => {
      expect(screen.getByText("ok")).toBeVisible();
    });
    expect(credentialMock.loadCredential).toHaveBeenCalledWith(
      "credential-anthropic-primary",
    );
    expect(cloudMock.generateStepCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "cloud",
        options: expect.objectContaining({
          cloudApiKey: "sk-test",
          cloudModel: "claude-opus-5-5",
          maxTokens: 16,
          temperature: 0,
        }),
      }),
      expect.any(Function),
    );
  });

  it("reports cloud connection errors", async () => {
    cloudMock.generateStepCloud.mockResolvedValue({
      type: "error",
      content: "Invalid API key",
    });
    render(<CloudProviderForm cloud={cloud()} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));

    expect(await screen.findByText("Invalid API key")).toBeVisible();
  });
});
