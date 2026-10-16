// Suggests a commit message from a diff with the assistant the person set up.
// Nothing is generated without an explicit click, and the result only fills
// the message box; the person edits and commits it themselves.

import type { AiConfig } from "../ai/aiConfig";
import { generateStep } from "../ai/aiClient";
import type { GenerateRequest } from "../ai/aiTypes";
import { resolveAiRuntime } from "../ai/product/aiRuntimeResolver";

/** Large diffs are cut so a local model stays fast; the summary still fits. */
const maxDiffChars = 12_000;

export function commitMessagePrompt(diff: string): string {
  const clipped =
    diff.length > maxDiffChars
      ? `${diff.slice(0, maxDiffChars)}\n… (diff truncated)`
      : diff;
  return [
    "Write a Git commit message for the changes below.",
    "Rules: one summary line in the imperative mood, at most 72 characters,",
    "no trailing period, no quotes, no Markdown. Add a short body after a",
    "blank line only when the change needs explaining. Reply with the message only.",
    "",
    clipped,
  ].join("\n");
}

/** The message from a model reply: no fences, quotes or "Commit message:" label. */
export function cleanCommitMessage(reply: string): string {
  let text = reply.trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/^(?:commit message|message)\s*:\s*/i, "");
  const lines = text.split("\n");
  lines[0] = lines[0]
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  return lines.join("\n").trim();
}

/** Whether the diff would leave this computer with the configured assistant. */
export function sendsDiffOnline(config: AiConfig): boolean {
  return config.provider === "cloud";
}

export async function generateCommitMessage(
  config: AiConfig,
  diff: string,
): Promise<string> {
  const runtime = resolveAiRuntime(config);
  const request: GenerateRequest = {
    requestId: `commit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    provider: runtime.provider,
    messages: [
      {
        role: "system",
        content: "You write concise, accurate Git commit messages.",
      },
      { role: "user", content: commitMessagePrompt(diff) },
    ],
    tools: [],
    options: {
      modelId: runtime.provider === "local" ? runtime.modelId : config.modelId,
      fileName: runtime.provider === "local" ? runtime.fileName : undefined,
      temperature: 0.2,
      effort: "low",
      maxTokens: 256,
      ollamaBaseUrl:
        runtime.provider === "ollama" ? runtime.baseUrl : config.ollamaBaseUrl,
      ollamaModel: runtime.provider === "ollama" ? runtime.model : config.ollamaModel,
      cloudVendor: config.cloud.vendor,
      cloudBaseUrl:
        runtime.provider === "cloud" ? runtime.baseUrl : config.cloud.baseUrl,
      cloudModel: runtime.provider === "cloud" ? runtime.model : config.cloud.model,
      cloudCredentialId:
        runtime.provider === "cloud" ? runtime.credentialId : config.cloud.credentialId,
    },
  };
  const step = await generateStep(request, () => {});
  if (step.type === "error") throw new Error(step.content);
  const message = cleanCommitMessage(step.content);
  if (!message) throw new Error("The assistant did not suggest a message.");
  return message;
}
