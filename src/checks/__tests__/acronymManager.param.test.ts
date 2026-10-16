import { describe, it, expect } from "vitest";
import { runAcronymChecks } from "../acronymManager";
import type { AcronymManagerSettings } from "../../types";

const full: AcronymManagerSettings = {
  enabled: true,
  checkUndefinedAcronym: true,
  checkDuplicateDefinition: true,
  checkUnusedAcronym: true,
  checkConflictingDefinitions: true,
};

function makeDoc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

// ── Undefined acronym patterns ───────────────────────────────────────────
const undefinedPatterns = [
  { text: "The CNN model works well.", ac: "CNN" },
  { text: "The RNN layer processes sequences.", ac: "RNN" },
  { text: "LSTM networks are powerful.", ac: "LSTM" },
  { text: "NLP tasks include translation.", ac: "NLP" },
  { text: "ML models require data.", ac: "ML" },
  { text: "AI systems are complex.", ac: "AI" },
  { text: "The API provides access.", ac: "API" },
  { text: "RGB color space.", ac: "RGB" },
  { text: "BERT model achieves SOTA.", ac: "BERT" },
  { text: "GAN generates images.", ac: "GAN" },
  { text: "VAE learns latent space.", ac: "VAE" },
  // ReLU has mixed case; might not be flagged — skip
  { text: "SGD optimizer converges.", ac: "SGD" },
  { text: "HPC cluster computing.", ac: "HPC" },
];
// Abbreviations every reader knows are never asked to be spelled out.
const wellKnown = ["GPU", "PDF", "HTML", "JSON", "CSV", "SQL"];
describe("Well-known abbreviations — parameterized", () => {
  it.each(wellKnown)("does not flag '%s'", (ac) => {
    const result = runAcronymChecks(makeDoc(`The ${ac} is used here.`), full);
    expect(result.some((d) => d.message.includes(`"${ac}"`))).toBe(false);
  });
});

describe("Undefined acronym detection — parameterized", () => {
  it.each(undefinedPatterns)("detects '$ac'", ({ text }) => {
    const result = runAcronymChecks(makeDoc(text), full);
    expect(result.some((d) => d.message.includes("used without definition"))).toBe(
      true,
    );
  });
});

// ── Common words NOT flagged ─────────────────────────────────────────────
const commonWords = [
  "The",
  "And",
  "For",
  "But",
  "Not",
  "Are",
  "Has",
  "Was",
  "Can",
  "May",
];
describe("Common words not flagged — parameterized", () => {
  it.each(commonWords)("does not flag '%s'", (word) => {
    const doc = makeDoc(`The ${word} is a common word that should not be flagged.`);
    const result = runAcronymChecks(doc, full);
    expect(
      result.filter((d) => d.message.includes("used without definition")),
    ).toHaveLength(0);
  });
});

// ── Definition patterns ─────────────────────────────────────────────────
const definitionPatterns = [
  { text: "Convolutional Neural Network (CNN) ... The CNN model.", ac: "CNN" },
  { text: "Recurrent Neural Network (RNN) ... The RNN layer.", ac: "RNN" },
  { text: "Long Short-Term Memory (LSTM) ... The LSTM.", ac: "LSTM" },
  { text: "Generative Adversarial Network (GAN) ... The GAN.", ac: "GAN" },
  { text: "Variational Autoencoder (VAE) ... The VAE.", ac: "VAE" },
  {
    text: "Bidirectional Encoder Representations from Transformers (BERT) ... The BERT.",
    ac: "BERT",
  },
  { text: "Generative Pre-trained Transformer (GPT) ... The GPT.", ac: "GPT" },
  { text: "Rectified Linear Unit (ReLU) ... The ReLU.", ac: "ReLU" },
  { text: "Graphics Processing Unit (GPU) ... The GPU.", ac: "GPU" },
  { text: "Application Programming Interface (API) ... The API.", ac: "API" },
  { text: "Natural Language Processing (NLP) ... NLP tasks.", ac: "NLP" },
  { text: "Machine Learning (ML) ... ML models.", ac: "ML" },
];
describe("Acronym definition patterns — parameterized", () => {
  it.each(definitionPatterns)("defines '$ac' then uses it", ({ text }) => {
    const result = runAcronymChecks(makeDoc(text), full);
    expect(
      result.filter((d) => d.message.includes("used without definition")),
    ).toHaveLength(0);
  });
});

// ── Check toggling ──────────────────────────────────────────────────────
describe("Check toggling — parameterized", () => {
  it("disabling undefined acronym removes its diagnostics", () => {
    const doc = makeDoc("CNN is used.");
    const enabled = runAcronymChecks(doc, { ...full, checkUndefinedAcronym: true });
    const disabled = runAcronymChecks(doc, { ...full, checkUndefinedAcronym: false });
    expect(
      enabled.some((d) => d.message.toLowerCase().includes("used without definition")),
    ).toBe(true);
    expect(
      disabled.some((d) => d.message.toLowerCase().includes("used without definition")),
    ).toBe(false);
  });
  it("disabling duplicate definition removes its diagnostics", () => {
    const doc = makeDoc(
      "Artificial Neural Network (ANN). Convolutional Neural Network (ANN).",
    );
    const enabled = runAcronymChecks(doc, { ...full, checkDuplicateDefinition: true });
    const disabled = runAcronymChecks(doc, {
      ...full,
      checkDuplicateDefinition: false,
    });
    expect(
      enabled.some((d) => d.message.toLowerCase().includes("defined multiple times")),
    ).toBe(true);
    expect(
      disabled.some((d) => d.message.toLowerCase().includes("defined multiple times")),
    ).toBe(false);
  });
  it("disabling unused acronym removes its diagnostics", () => {
    const doc = makeDoc("Artificial Neural Network (ANN) and other content.");
    const enabled = runAcronymChecks(doc, { ...full, checkUnusedAcronym: true });
    const disabled = runAcronymChecks(doc, { ...full, checkUnusedAcronym: false });
    expect(
      enabled.some((d) => d.message.toLowerCase().includes("never used again")),
    ).toBe(true);
    expect(
      disabled.some((d) => d.message.toLowerCase().includes("never used again")),
    ).toBe(false);
  });
  it("disabling conflicting definitions removes its diagnostics", () => {
    const doc = makeDoc("Convolutional (CNN). Capsule (CNN).");
    const enabled = runAcronymChecks(doc, {
      ...full,
      checkConflictingDefinitions: true,
    });
    const disabled = runAcronymChecks(doc, {
      ...full,
      checkConflictingDefinitions: false,
    });
    expect(enabled.some((d) => d.message.toLowerCase().includes("conflicting"))).toBe(
      true,
    );
    expect(disabled.some((d) => d.message.toLowerCase().includes("conflicting"))).toBe(
      false,
    );
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────
const edgeCases = [
  { desc: "empty document", doc: makeDoc("") },
  {
    desc: "no acronyms",
    doc: makeDoc(
      "This paper presents a new method for solving problems in computer science.",
    ),
  },
  { desc: "unicode text", doc: makeDoc("∀x ∃y: CNN model works") },
  {
    desc: "very long document",
    doc: makeDoc(Array(5000).fill("word").join(" ") + " CNN "),
  },
  { desc: "acronyms in math mode", doc: makeDoc("The $CNN$ and $RNN$ are compared.") },
];
describe("Edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ doc }) => {
    const result = runAcronymChecks(doc, full);
    expect(Array.isArray(result)).toBe(true);
  });
});
