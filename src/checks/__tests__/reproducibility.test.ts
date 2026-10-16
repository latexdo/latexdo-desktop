import { describe, it, expect } from "vitest";
import { runReproducibilityChecks } from "../reproducibility";
import type { ReproducibilitySettings } from "../../types";

const defaultSettings: ReproducibilitySettings = {
  enabled: true,
  checkCodeLink: true,
  checkDatasetLink: true,
  checkLicenseMentioned: true,
  checkHyperparameters: true,
  checkHardwareDetails: true,
  checkRandomSeeds: true,
  checkEvaluationMetrics: true,
};

// Enough ML signals to switch on the ML-only checks, and nothing they look for.
const mlPaper = "Our neural network is improved by fine-tuning with gradient descent.";

function makeDoc(content: string): string {
  return (
    "\\documentclass{article}\n\\begin{document}\n" + content + "\n\\end{document}\n"
  );
}

describe("runReproducibilityChecks", () => {
  it("skips the ML-only checks on papers that train no models", () => {
    const result = runReproducibilityChecks(makeDoc("Hello."), defaultSettings);
    expect(
      result.some((d) => /Hyperparameters|Hardware|seeds|metrics/.test(d.message)),
    ).toBe(false);
  });

  it("asks for a license only once code is released", () => {
    const result = runReproducibilityChecks(makeDoc("Hello."), defaultSettings);
    expect(result.some((d) => d.message.includes("License"))).toBe(false);
  });

  it("returns empty when disabled", () => {
    expect(
      runReproducibilityChecks("content", { ...defaultSettings, enabled: false }),
    ).toHaveLength(0);
  });

  it("returns empty when content is empty", () => {
    expect(runReproducibilityChecks("", defaultSettings)).toHaveLength(0);
  });

  describe("Code link", () => {
    it("warns when no code link found", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), defaultSettings);
      expect(result.some((d) => d.message.includes("Code availability"))).toBe(true);
    });

    it("detects GitHub URL", () => {
      const result = runReproducibilityChecks(
        makeDoc("Code at \\url{https://github.com/user/repo}."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Code availability"))).toBe(false);
    });

    it("detects \\github command", () => {
      const result = runReproducibilityChecks(
        makeDoc("\\github{user/repo}."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Code availability"))).toBe(false);
    });

    it("detects 'code availability' phrase", () => {
      const result = runReproducibilityChecks(
        makeDoc("Code availability statement."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Code availability"))).toBe(false);
    });

    it("skips when disabled", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), {
        ...defaultSettings,
        checkCodeLink: false,
      });
      expect(result.some((d) => d.message.includes("Code"))).toBe(false);
    });
  });

  describe("Dataset link", () => {
    it("warns when no dataset link found", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), defaultSettings);
      expect(result.some((d) => d.message.includes("Dataset availability"))).toBe(true);
    });

    it("detects Zenodo URL", () => {
      const result = runReproducibilityChecks(
        makeDoc("Data at \\url{https://zenodo.org/record/12345}."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Dataset"))).toBe(false);
    });

    it("detects Figshare URL", () => {
      const result = runReproducibilityChecks(
        makeDoc("Data at \\url{https://figshare.com/12345}."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Dataset"))).toBe(false);
    });

    it("detects 'data availability' phrase", () => {
      const result = runReproducibilityChecks(
        makeDoc("Data availability statement."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Dataset"))).toBe(false);
    });

    it("skips when disabled", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), {
        ...defaultSettings,
        checkDatasetLink: false,
      });
      expect(result.some((d) => d.message.includes("Dataset"))).toBe(false);
    });
  });

  describe("License", () => {
    it("warns when released code has no license", () => {
      const result = runReproducibilityChecks(
        makeDoc("Code: https://github.com/acme/tool"),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("License"))).toBe(true);
    });

    it("detects MIT license", () => {
      const result = runReproducibilityChecks(
        makeDoc("Released under MIT License."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("License"))).toBe(false);
    });

    it("detects Apache 2.0", () => {
      const result = runReproducibilityChecks(
        makeDoc("Apache 2.0 license."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("License"))).toBe(false);
    });

    it("detects Creative Commons", () => {
      const result = runReproducibilityChecks(
        makeDoc("Creative Commons license."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("License"))).toBe(false);
    });

    it("skips when disabled", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), {
        ...defaultSettings,
        checkLicenseMentioned: false,
      });
      expect(result.some((d) => d.message.includes("License"))).toBe(false);
    });
  });

  describe("Hyperparameters", () => {
    it("warns when no hyperparameters found", () => {
      const result = runReproducibilityChecks(makeDoc(mlPaper), defaultSettings);
      expect(result.some((d) => d.message.includes("Hyperparameters"))).toBe(true);
    });

    it("detects learning rate mention", () => {
      const result = runReproducibilityChecks(
        makeDoc("Learning rate is 0.001."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Hyperparameters"))).toBe(false);
    });

    it("detects batch size", () => {
      const result = runReproducibilityChecks(
        makeDoc("Batch size is 64."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Hyperparameters"))).toBe(false);
    });

    it("detects epoch count", () => {
      const result = runReproducibilityChecks(
        makeDoc("We train for 100 epochs."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Hyperparameters"))).toBe(false);
    });

    it("skips when disabled", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), {
        ...defaultSettings,
        checkHyperparameters: false,
      });
      expect(result.some((d) => d.message.includes("Hyperparameters"))).toBe(false);
    });
  });

  describe("Hardware details", () => {
    it("warns when no hardware details found", () => {
      const result = runReproducibilityChecks(makeDoc(mlPaper), defaultSettings);
      expect(result.some((d) => d.message.includes("Hardware"))).toBe(true);
    });

    it("detects GPU mention", () => {
      const result = runReproducibilityChecks(
        makeDoc("Trained on NVIDIA A100 GPU."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Hardware"))).toBe(false);
    });

    it("detects CPU mention", () => {
      const result = runReproducibilityChecks(
        makeDoc("Experiments on Intel Xeon CPU."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Hardware"))).toBe(false);
    });

    it("detects runtime mention", () => {
      const result = runReproducibilityChecks(
        makeDoc("Training time: 2 hours."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("Hardware"))).toBe(false);
    });

    it("skips when disabled", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), {
        ...defaultSettings,
        checkHardwareDetails: false,
      });
      expect(result.some((d) => d.message.includes("Hardware"))).toBe(false);
    });
  });

  describe("Random seeds", () => {
    it("warns when no random seeds mentioned", () => {
      const result = runReproducibilityChecks(makeDoc(mlPaper), defaultSettings);
      expect(result.some((d) => d.message.includes("seeds"))).toBe(true);
    });

    it("detects 'random seed' phrase", () => {
      const result = runReproducibilityChecks(
        makeDoc("Random seed is set to 42."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("seeds"))).toBe(false);
    });

    it("detects numpy seed", () => {
      const result = runReproducibilityChecks(
        makeDoc("numpy.random.seed(42)."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("seeds"))).toBe(false);
    });

    it("detects torch manual seed", () => {
      const result = runReproducibilityChecks(
        makeDoc("torch.manual_seed(42)."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("seeds"))).toBe(false);
    });

    it("detects 'deterministic'", () => {
      const result = runReproducibilityChecks(
        makeDoc("Deterministic mode enabled."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("seeds"))).toBe(false);
    });

    it("skips when disabled", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), {
        ...defaultSettings,
        checkRandomSeeds: false,
      });
      expect(result.some((d) => d.message.includes("seeds"))).toBe(false);
    });
  });

  describe("Evaluation metrics", () => {
    it("warns when no metrics found", () => {
      const result = runReproducibilityChecks(makeDoc(mlPaper), defaultSettings);
      expect(result.some((d) => d.message.includes("metrics"))).toBe(true);
    });

    it("detects accuracy mention", () => {
      const result = runReproducibilityChecks(
        makeDoc("Accuracy is 95%."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("metrics"))).toBe(false);
    });

    it("detects F1 score", () => {
      const result = runReproducibilityChecks(
        makeDoc("F1-score of 0.9."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("metrics"))).toBe(false);
    });

    it("detects MSE", () => {
      const result = runReproducibilityChecks(makeDoc("MSE is 0.01."), defaultSettings);
      expect(result.some((d) => d.message.includes("metrics"))).toBe(false);
    });

    it("detects BLEU", () => {
      const result = runReproducibilityChecks(
        makeDoc("BLEU score of 35."),
        defaultSettings,
      );
      expect(result.some((d) => d.message.includes("metrics"))).toBe(false);
    });

    it("skips when disabled", () => {
      const result = runReproducibilityChecks(makeDoc("Hello."), {
        ...defaultSettings,
        checkEvaluationMetrics: false,
      });
      expect(result.some((d) => d.message.includes("metrics"))).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("handles content with all checks passing", () => {
      const doc = makeDoc(
        `Code at \\url{https://github.com/user/repo}. Data at \\url{https://zenodo.org/12345}. MIT License. Learning rate 0.001, batch 64. NVIDIA A100 GPU. Random seed 42. Accuracy 95%.`,
      );
      const result = runReproducibilityChecks(doc, defaultSettings);
      expect(result).toHaveLength(0);
    });

    it("handles very large document", () => {
      const doc = makeDoc(Array(5000).fill("word").join(" "));
      const result = runReproducibilityChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles empty document with preamble only", () => {
      const result = runReproducibilityChecks(
        "\\documentclass{article}",
        defaultSettings,
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
