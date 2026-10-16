import { describe, it, expect } from "vitest";
import { runReproducibilityChecks } from "../reproducibility";
import type { ReproducibilitySettings } from "../../types";

const full: ReproducibilitySettings = {
  enabled: true,
  checkCodeLink: true,
  checkDatasetLink: true,
  checkLicenseMentioned: true,
  checkHyperparameters: true,
  checkHardwareDetails: true,
  checkRandomSeeds: true,
  checkEvaluationMetrics: true,
};

// ── Individual check toggling ────────────────────────────────────────────
type CheckField = keyof Omit<ReproducibilitySettings, "enabled">;
const checkToggles: [string, CheckField, string][] = [
  ["code link", "checkCodeLink", "Code availability"],
  ["dataset link", "checkDatasetLink", "Dataset availability"],
  ["license", "checkLicenseMentioned", "License"],
  ["hyperparameters", "checkHyperparameters", "Hyperparameters"],
  ["hardware", "checkHardwareDetails", "Hardware"],
  ["seeds", "checkRandomSeeds", "seeds"],
  ["metrics", "checkEvaluationMetrics", "metrics"],
];
describe("Toggle toggling — parameterized", () => {
  it.each(checkToggles)("disabling %s removes its diagnostics", (name, field, msg) => {
    // License needs released code; the ML-only checks need an ML paper.
    const body =
      field === "checkLicenseMentioned"
        ? "Code: https://github.com/acme/tool"
        : field === "checkCodeLink" || field === "checkDatasetLink"
          ? "Hello."
          : "Our neural network is improved by fine-tuning with gradient descent.";
    const doc = `\\documentclass{article}\\begin{document}${body}\\end{document}`;
    const enabled = runReproducibilityChecks(doc, { ...full, [field]: true });
    const disabled = runReproducibilityChecks(doc, { ...full, [field]: false });
    expect(enabled.some((d) => d.message.includes(msg))).toBe(true);
    expect(disabled.some((d) => d.message.includes(msg))).toBe(false);
  });
});

// ── Code link detection ──────────────────────────────────────────────────
const codeLinks = [
  { desc: "github URL", doc: "\\url{https://github.com/user/repo}" },
  { desc: "github command", doc: "\\github{user/repo}" },
  { desc: "code availability phrase", doc: "Code availability: see repository." },
  { desc: "source code phrase", doc: "Source code is available at the repository." },
  { desc: "true URL with github", doc: "\\href{https://github.com/user/repo}{code}" },
];
describe("Code link detection — parameterized", () => {
  it.each(codeLinks)("detects $desc", ({ doc }) => {
    const content =
      "\\documentclass{article}\\begin{document}" + doc + "\\end{document}";
    const result = runReproducibilityChecks(content, full);
    expect(result.some((d) => d.message.includes("Code availability"))).toBe(false);
  });
});

// ── Dataset link detection ───────────────────────────────────────────────
const datasetLinks = [
  { desc: "zenodo URL", url: "https://zenodo.org/record/12345" },
  { desc: "figshare URL", url: "https://figshare.com/12345" },
  { desc: "dataset phrase", phrase: "Dataset is available upon request." },
  { desc: "data availability", phrase: "Data availability: see repository." },
  { desc: "huggingface URL", url: "https://huggingface.co/datasets/name" },
];
describe("Dataset link detection — parameterized", () => {
  it.each(datasetLinks)("detects $desc", ({ url, phrase }) => {
    const text = url || phrase || "";
    const content =
      "\\documentclass{article}\\begin{document}" + text + "\\end{document}";
    const result = runReproducibilityChecks(content, full);
    expect(result.some((d) => d.message.includes("Dataset"))).toBe(false);
  });
});

// ── License detection ────────────────────────────────────────────────────
const licenses = [
  { desc: "MIT", text: "MIT License" },
  { desc: "Apache 2.0", text: "Apache 2.0" },
  { desc: "BSD", text: "BSD license" },
  { desc: "Creative Commons", text: "Creative Commons Attribution" },
  { desc: "GPL", text: "GPL v3" },
  { desc: "CC0", text: "CC0 1.0" },
  { desc: "released under", text: "released under the MIT license" },
  { desc: "licensed under", text: "licensed under Apache 2.0" },
];
describe("License detection — parameterized", () => {
  it.each(licenses)("detects $desc", ({ text }) => {
    const content =
      "\\documentclass{article}\\begin{document}" + text + "\\end{document}";
    const result = runReproducibilityChecks(content, full);
    expect(result.some((d) => d.message.includes("License"))).toBe(false);
  });
});

// ── Hyperparameter detection ────────────────────────────────────────────
const hyperparams = [
  { desc: "learning rate", text: "learning rate = 0.001" },
  { desc: "batch size", text: "batch size 64" },
  { desc: "epochs", text: "100 epochs" },
  { desc: "optimizer", text: "Adam optimizer" },
  { desc: "dropout", text: "dropout 0.5" },
  { desc: "weight decay", text: "weight decay 1e-4" },
  { desc: "hidden dimension", text: "hidden dimension 512" },
  { desc: "number of layers", text: "number of layers 6" },
  { desc: "parameter setting", text: "parameter settings" },
  { desc: "configuration", text: "experimental configuration" },
];
describe("Hyperparameter detection — parameterized", () => {
  it.each(hyperparams)("detects $desc", ({ text }) => {
    const content =
      "\\documentclass{article}\\begin{document}" + text + "\\end{document}";
    const result = runReproducibilityChecks(content, full);
    expect(result.some((d) => d.message.includes("Hyperparameters"))).toBe(false);
  });
});

// ── Hardware detection ───────────────────────────────────────────────────
const hardware = [
  { desc: "GPU", text: "NVIDIA A100 GPU" },
  { desc: "CPU", text: "Intel Xeon CPU" },
  { desc: "RAM", text: "64GB RAM" },
  { desc: "cluster", text: "computing cluster" },
  { desc: "training time", text: "training time: 2 hours" },
  { desc: "implementation details", text: "implementation details" },
  { desc: "Apple silicon", text: "Apple M2 Pro" },
];
describe("Hardware detection — parameterized", () => {
  it.each(hardware)("detects $desc", ({ text }) => {
    const content =
      "\\documentclass{article}\\begin{document}" + text + "\\end{document}";
    const result = runReproducibilityChecks(content, full);
    expect(result.some((d) => d.message.includes("Hardware"))).toBe(false);
  });
});

// ── Seed detection ───────────────────────────────────────────────────────
const seeds = [
  { desc: "random seed phrase", text: "random seed is set to 42" },
  { desc: "seed equals", text: "seed=42" },
  { desc: "numpy seed", text: "numpy.random.seed(42)" },
  { desc: "torch manual seed", text: "torch.manual_seed(42)" },
  { desc: "deterministic", text: "deterministic training" },
  { desc: "tf seed", text: "tf.random.set_seed(42)" },
  { desc: "reproducibility", text: "reproducibility details" },
  { desc: "seed value", text: "seed value 42" },
];
describe("Seed detection — parameterized", () => {
  it.each(seeds)("detects $desc", ({ text }) => {
    const content =
      "\\documentclass{article}\\begin{document}" + text + "\\end{document}";
    const result = runReproducibilityChecks(content, full);
    expect(result.some((d) => d.message.includes("seeds"))).toBe(false);
  });
});

// ── Metric detection ─────────────────────────────────────────────────────
const metrics = [
  { desc: "accuracy", text: "accuracy of 95%" },
  { desc: "F1 score", text: "F1-score of 0.9" },
  { desc: "precision", text: "precision 0.95" },
  { desc: "recall", text: "recall 0.93" },
  { desc: "MSE", text: "MSE of 0.01" },
  { desc: "MAE", text: "MAE 0.05" },
  { desc: "BLEU", text: "BLEU score 35.2" },
  { desc: "perplexity", text: "perplexity 15.3" },
  { desc: "AUC", text: "AUROC 0.97" },
  { desc: "IoU", text: "Intersection over Union 0.85" },
  { desc: "loss", text: "training loss 0.1" },
  { desc: "training time metric", text: "inference time 2ms" },
  { desc: "evaluation metric", text: "evaluation metric" },
];
describe("Metric detection — parameterized", () => {
  it.each(metrics)("detects $desc", ({ text }) => {
    const content =
      "\\documentclass{article}\\begin{document}" + text + "\\end{document}";
    const result = runReproducibilityChecks(content, full);
    expect(result.some((d) => d.message.includes("metrics"))).toBe(false);
  });
});

// ── All-passes document ─────────────────────────────────────────────────
describe("All checks pass", () => {
  it("passes for a complete reproducibility document", () => {
    const doc =
      "\\documentclass{article}\\begin{document}Code at \\url{https://github.com/user/repo}. Data on \\url{https://zenodo.org/12345}. MIT License. Learning rate 0.001, batch 64, 100 epochs, Adam. NVIDIA A100 GPU. Random seed 42. Accuracy 95%, F1 0.9.\\end{document}";
    const result = runReproducibilityChecks(doc, full);
    expect(result).toHaveLength(0);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────
const edgeCases = [
  {
    desc: "empty document",
    doc: "\\documentclass{article}\\begin{document}\\end{document}",
  },
  {
    desc: "very large document",
    doc:
      "\\documentclass{article}\\begin{document}" +
      Array(10000).fill("word").join(" ") +
      "\\end{document}",
  },
];
describe("Reproducibility edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ doc }) => {
    const result = runReproducibilityChecks(doc, full);
    expect(Array.isArray(result)).toBe(true);
  });
});
