// End-to-end check of the local agent against a real downloaded model.
// Opt-in, because it needs the model file and a few minutes:
//
//   LATEXDO_LIVE_LOCAL=1 npx vitest run src/localLlm.live.test.ts
//
// LATEXDO_LIVE_MODEL picks the GGUF file (default: qwen3-4b-q4_k_m.gguf).

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = path.join(os.homedir(), "Library", "Application Support", "LatexDo");
vi.mock("electron", () => ({ app: { getPath: () => dataDir } }));

import { runAgent, type AgentEvent } from "./features/ai/aiAgent";
import { buildSystemPrompt, buildTurnContext } from "./features/ai/aiSystemPrompt";
import { availableAgentToolSchemas, type AgentContext } from "./features/ai/aiTools";
import type { ChatMessage } from "./features/ai/aiTypes";
import { generateLocalStep, unloadLocalModel } from "../electron/ai/localLlm.js";

const fileName = process.env.LATEXDO_LIVE_MODEL ?? "qwen3-4b-q4_k_m.gguf";
const live =
  process.env.LATEXDO_LIVE_LOCAL === "1" &&
  existsSync(path.join(dataDir, "models", fileName));

const access = {
  chatHistory: true,
  currentEditor: true,
  projectFiles: true,
  bibliography: true,
  researcherProfile: false,
};

function project(files: Record<string, string>) {
  const writes: Array<{ path: string; content: string }> = [];
  let compiles = 0;
  const ctx: AgentContext = {
    hasProject: () => true,
    projectName: () => "sparse-attention",
    activeFilePath: () => "main.tex",
    listFiles: async () => Object.keys(files),
    readFile: async (file) => {
      if (!(file in files)) throw new Error(`No such file: ${file}`);
      return files[file];
    },
    writeFile: async (file, content) => {
      files[file] = content;
      writes.push({ path: file, content });
    },
    documentText: () => files["main.tex"],
    selection: () => ({ text: "", hasSelection: false }),
    applyEdit: async () => undefined,
    compile: async () => {
      compiles += 1;
      const ok = files["main.tex"].includes("\\end{itemize}");
      return ok
        ? { ok: true, log: "Output written on main.pdf (1 page).", diagnostics: [] }
        : {
            ok: false,
            log: "! LaTeX Error: \\begin{itemize} on input line 6 ended by \\end{document}.",
            diagnostics: [
              "main.tex:9: LaTeX Error: \\begin{itemize} on input line 6 ended by \\end{document}.",
            ],
          };
    },
    runChecks: async () => "No findings.",
    insertCitation: async () => "No bibliography entries match.",
    recommendCitations: async () => "No bibliography entries match.",
    requestApproval: async () => true,
  };
  return { ctx, writes, compiles: () => compiles };
}

async function ask(
  ctx: AgentContext,
  question: string,
): Promise<{ answer: string; events: AgentEvent[]; ms: number }> {
  const tools = availableAgentToolSchemas({
    hasProject: true,
    hasActiveDocument: true,
    hasSelection: false,
    access,
  });
  const projectFiles = await ctx.listFiles();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        perTurnContext: true,
        userName: "",
        projectName: ctx.projectName(),
        activeFilePath: "main.tex",
        hasSelection: false,
        providerSupportsNativeTools: true,
        availableTools: tools,
        access,
      }),
    },
    {
      role: "user",
      content: `${buildTurnContext({
        activeFilePath: "main.tex",
        hasSelection: false,
        projectFiles,
      })}\n\n${question}`,
    },
  ];
  const events: AgentEvent[] = [];
  const started = Date.now();
  await runAgent({
    messages,
    ctx,
    tools,
    generate: (history, toolList, onToken, onThinking) =>
      generateLocalStep(
        history,
        { fileName, effort: "high", maxTokens: 4096 },
        onToken,
        undefined,
        toolList,
        () => onThinking?.(),
      ),
    autoApprove: true,
    maxSteps: 12,
    nudgeUnappliedChanges: true,
    onEvent: (event) => {
      events.push(event);
      if (process.env.LATEXDO_LIVE_TRACE === "1") {
        if (event.type === "tool-start")
          process.stderr.write(
            `  → ${event.call.name} ${JSON.stringify(event.call.args).slice(0, 300)}\n`,
          );
        if (event.type === "tool-result")
          process.stderr.write(
            `  ← ${event.ok ? "ok" : "FAIL"} ${event.content.slice(0, 200)}\n`,
          );
      }
    },
  });
  const answer =
    [...events].reverse().find((event) => event.type === "assistant-message")?.type ===
    "assistant-message"
      ? (
          [...events].reverse().find((event) => event.type === "assistant-message") as {
            text: string;
          }
        ).text
      : "";
  const ms = Date.now() - started;
  const calls = events
    .filter((event) => event.type === "tool-start")
    .map((event) => (event as { call: { name: string } }).call.name);
  process.stderr.write(
    `[live] ${question}\n  tools: ${calls.join(" → ")}\n  ${ms} ms\n  ${answer.slice(0, 160)}\n`,
  );
  return { answer, events, ms };
}

const intro = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
We study sparse attention for long-document summarization and show a threefold
speedup over dense attention at equal ROUGE.
\begin{itemize}
  \item Linear memory in sequence length.
  \item No loss in summary quality.
\end{document}
`;

describe.skipIf(!live)("local agent with a real model", () => {
  afterAll(async () => {
    await unloadLocalModel();
  });

  it("reads the project to answer a question about it", async () => {
    const { ctx } = project({ "main.tex": intro, "refs.bib": "" });
    const { answer, events } = await ask(ctx, "What is the introduction about?");
    expect(
      events.some(
        (event) =>
          event.type === "tool-start" &&
          ["read_file", "get_active_document"].includes(event.call.name),
      ),
    ).toBe(true);
    expect(answer.toLowerCase()).toMatch(/sparse attention|summari/);
  }, 300_000);

  it("finds and fixes a compile error", async () => {
    const files = { "main.tex": intro, "refs.bib": "" };
    const { ctx, writes } = project(files);
    const { events } = await ask(
      ctx,
      "The PDF does not build. Find and fix the error.",
    );
    expect(writes.length).toBeGreaterThan(0);
    expect(files["main.tex"]).toContain("\\end{itemize}");
    expect(files["main.tex"]).toContain("\\section{Introduction}");
    expect(events.some((event) => event.type === "error")).toBe(false);
  }, 300_000);
});
