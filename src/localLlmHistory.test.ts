import { describe, expect, it, vi } from "vitest";

// localLlm imports models.js which touches Electron's app paths at call time;
// mock the module so this pure-function test runs under vitest.
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

import { toLlamaFunctions, toLlamaHistory } from "../electron/ai/localLlm.js";

describe("toLlamaHistory (node-llama-cpp chat history mapping)", () => {
  it("maps assistant turns to model items with a response array", () => {
    // Regression: `{type: "model", text}` crashes node-llama-cpp with
    // "Cannot read properties of undefined (reading 'filter')".
    expect(
      toLlamaHistory([
        { role: "system", content: "a" },
        { role: "system", content: "b" },
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "follow-up" },
      ]),
    ).toEqual([
      { type: "system", text: "a\n\nb" },
      { type: "user", text: "first question" },
      { type: "model", response: ["first answer"] },
      { type: "user", text: "follow-up" },
    ]);
  });

  it("folds a tool round into one model turn with the results attached", () => {
    const history = toLlamaHistory([
      { role: "user", content: "fix it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "1", name: "read_file", args: { path: "main.tex" } },
          { id: "2", name: "compile", args: {} },
        ],
        providerContent: {
          kind: "llama",
          response: [
            { type: "segment", segmentType: "thought", text: "hm", ended: true },
          ],
          rawCalls: [{ raw: 1 }, { raw: 2 }],
        },
      },
      { role: "tool", content: "\\section{Intro}", toolCallId: "1" },
      { role: "tool", content: "Compiled.", toolCallId: "2" },
      { role: "assistant", content: "All good." },
    ]);
    expect(history).toEqual([
      { type: "user", text: "fix it" },
      {
        type: "model",
        response: [
          { type: "segment", segmentType: "thought", text: "hm", ended: true },
          {
            type: "functionCall",
            name: "read_file",
            params: { path: "main.tex" },
            result: "\\section{Intro}",
            rawCall: { raw: 1 },
          },
          {
            type: "functionCall",
            name: "compile",
            params: {},
            result: "Compiled.",
            rawCall: { raw: 2 },
          },
          "All good.",
        ],
      },
    ]);
  });

  it("keeps a tool result whose call was trimmed away as readable text", () => {
    expect(
      toLlamaHistory([
        { role: "tool", content: "Compiled.", name: "compile", toolCallId: "gone" },
      ]),
    ).toEqual([{ type: "user", text: "Tool compile result:\nCompiled." }]);
  });
});

describe("toLlamaFunctions", () => {
  it("lets optional parameters be null and keeps enums", () => {
    expect(
      toLlamaFunctions([
        {
          name: "run_checks",
          description: "Run checks",
          params: {
            kind: {
              type: "string",
              description: "Which",
              enum: ["citations", "structure"],
            },
            note: { type: "string", description: "Optional note" },
          },
          required: ["kind"],
        },
        { name: "compile", description: "Compile", params: {}, required: [] },
      ]),
    ).toEqual({
      run_checks: {
        description: "Run checks",
        params: {
          type: "object",
          properties: {
            kind: { enum: ["citations", "structure"], description: "Which" },
            note: { type: ["string", "null"], description: "Optional note" },
          },
        },
      },
      compile: { description: "Compile", params: undefined },
    });
  });
});
