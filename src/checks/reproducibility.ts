import type { Diagnostic, ReproducibilitySettings } from "../types";

function findLine(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function makeDiagnostic(
  line: number,
  message: string,
  detail: string,
  suggestion: string,
): Diagnostic {
  return {
    file: "check",
    line,
    column: 1,
    severity: "warning",
    source: "latex" as Diagnostic["source"],
    message,
    detail,
    suggestion,
  };
}

function checkCodeLinkImpl(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const patterns = [
    /\\github\s*\{[^}]*\}/i,
    /https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/i,
    /\\url\s*\{[^}]*github[^}]*\}/i,
    /\\href\s*\{[^}]*github[^}]*\}/i,
    /codebase/i,
    /source\s+code/i,
    /code\s+availability/i,
    /available\s+at/i,
  ];
  const found = patterns.some((p) => p.test(content));
  if (!found) {
    diag.push(
      makeDiagnostic(
        1,
        "Code availability link not found",
        "Reproducible research should provide a link to the source code repository (e.g., GitHub, Zenodo)",
        'Add a \\github{username/repo} command or \\url{https://github.com/username/repo} in a dedicated "Code Availability" section',
      ),
    );
  }
  return diag;
}

function checkDatasetLinkImpl(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const patterns = [
    /https?:\/\/(?:www\.)?(?:zenodo|figshare|dryad|osf|huggingface|kaggle)\./i,
    /dataset/i,
    /data\s+availability/i,
    /data\s+is\s+available/i,
    /data\s+can\s+be\s+(?:downloaded|accessed|found)/i,
    /\\url\s*\{[^}]*data[^}]*\}/i,
  ];
  const found = patterns.some((p) => p.test(content));
  if (!found) {
    diag.push(
      makeDiagnostic(
        1,
        "Dataset availability not mentioned",
        "Papers using datasets should state where the data can be accessed (e.g., Zenodo, Figshare, Hugging Face)",
        'Add a "Data Availability" section with a DOI or URL pointing to the dataset repository',
      ),
    );
  }
  return diag;
}

function checkLicenseMentionedImpl(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const patterns = [
    /\blicense\b/i,
    /\bmit\s+license\b/i,
    /\bapache\s+2\.0\b/i,
    /\bbsd\b/i,
    /\bcc\s+by\b/i,
    /\bcc0\b/i,
    /\bgpl\b/i,
    /\bcreative\s+commons\b/i,
    /\bopen\s+source\b/i,
    /\breleased\s+under\b/i,
    /\blicensed\s+under\b/i,
  ];
  const found = patterns.some((p) => p.test(content));
  if (!found) {
    diag.push(
      makeDiagnostic(
        1,
        "License information not mentioned",
        "Reproducible research should specify the license under which code/data is released",
        'Add a sentence like "The code is released under the MIT License at \\url{https://github.com/...}"',
      ),
    );
  }
  return diag;
}

function checkHyperparametersImpl(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const patterns = [
    /\bhyperparam(?:eter)?s?\b/i,
    /\blearning\s+rate\b/i,
    /\bbatch\s+(?:size|number)\b/i,
    /\bepochs?\b/i,
    /\boptimizer\b/i,
    /\bmomentum\b/i,
    /\bweight\s+decay\b/i,
    /\bdropout\b/i,
    /\bembedding\s+dim(?:ension)?\b/i,
    /\bhidden\s+(?:size|dimension|units?)\b/i,
    /\bnumber\s+of\s+(?:layers|heads)\b/i,
    /\bparameter\s+setting/i,
    /\bconfiguration\b/i,
    /\bhyperparameter\s+search\b/i,
  ];
  const found = patterns.some((p) => p.test(content));
  if (!found) {
    diag.push(
      makeDiagnostic(
        1,
        "Hyperparameters not listed",
        "Reproducible ML research should list all hyperparameters used in experiments",
        "Add a table or paragraph listing key hyperparameters (learning rate, batch size, epochs, optimizer, etc.) in the experimental setup section",
      ),
    );
  }
  return diag;
}

function checkHardwareDetailsImpl(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const patterns = [
    /\bgpu\b/i,
    /\b(?:nvidia|amd|intel|apple)\b/i,
    /\b(?:tesla|a100|v100|h100|rtx|quadro|titan)\b/i,
    /\bcpu\b/i,
    /\b(?:xeon|core\s+i\d|epyc|m\d|m\s+pro|m\s+max|m\s+ultra)\b/i,
    /\b(?:gb|tb|ram)\b/i,
    /\b(?:memory|processor)\b/i,
    /\b(?:cluster|server|workstation|cloud)\b/i,
    /\b(?:google\s+cloud|aws|azure)\b/i,
    /\b(?:colab|kaggle)\b/i,
    /\bruntime\b/i,
    /\btraining\s+(?:time|duration)\b/i,
    /\bwall\s+clock\b/i,
    /\bimplementation\s+details\b/i,
  ];
  const found = patterns.some((p) => p.test(content));
  if (!found) {
    diag.push(
      makeDiagnostic(
        1,
        "Hardware/Computing details not specified",
        "Reproducible experiments should describe the hardware used (GPU model, CPU, RAM, training time)",
        'Add implementation details specifying the hardware: e.g., "Experiments were run on an NVIDIA A100 GPU with 40GB memory"',
      ),
    );
  }
  return diag;
}

function checkRandomSeedsImpl(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const patterns = [
    /\b(?:random\s+)?seed\b/i,
    /\bseed\s*=\s*\d+\b/i,
    /\bnumpy\.random\.seed/i,
    /\btorch\.manual_seed/i,
    /\btf\.random\.set_seed/i,
    /\brandom\.seed\b/i,
    /\breproducibility\b/i,
    /\bdeterministic\b/i,
    /\brandom\s+seed\s+is\s+set\b/i,
    /\bseed\s+value\b/i,
  ];
  const found = patterns.some((p) => p.test(content));
  if (!found) {
    diag.push(
      makeDiagnostic(
        1,
        "Random seeds not mentioned",
        "Using random seeds ensures experiments can be exactly reproduced. The paper should mention if and how random seeds were set",
        'Add a sentence: "We set random seeds (e.g., seed=42) for all stochastic processes to ensure reproducibility"',
      ),
    );
  }
  return diag;
}

function checkEvaluationMetricsImpl(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const patterns = [
    /\b(?:evaluation\s+)?metric/,
    /\baccuracy\b/i,
    /\bf1[-\s]score\b/i,
    /\b(?:precision|recall)\b/i,
    /\bauroc\b/i,
    /\bauprc\b/i,
    /\bmse\b/i,
    /\brmse\b/i,
    /\bmae\b/i,
    /\b(?:bleu|rouge|perplexity)\b/i,
    /\b(?:loss|error\s+rate)\b/i,
    /\b(?:mean\s+average\s+precision|map)\b/i,
    /\b(?:intersection\s+over\s+union|iou)\b/i,
    /\bspeedup\b/i,
    /\bthroughput\b/i,
    /\b(?:training|inference)\s+time\b/i,
    /\b(?:statistical\s+)?significance\b/i,
    /\bconfidence\s+interval\b/i,
    /\bstandard\s+deviation\b/i,
  ];
  const found = patterns.some((p) => p.test(content));
  if (!found) {
    diag.push(
      makeDiagnostic(
        1,
        "Evaluation metrics not clearly defined",
        "The paper should explicitly state which metrics are used to evaluate results and how they are computed",
        'Define all evaluation metrics: e.g., "We report accuracy, F1-score, and inference time, averaged over 5 runs with standard deviations"',
      ),
    );
  }
  return diag;
}

// Hyperparameters, hardware, seeds and metrics only matter for papers that
// train or benchmark models; asking a user study for its GPU is noise.
export function looksLikeMachineLearning(content: string): boolean {
  const signals = content.match(
    /\b(?:train(?:ing|ed)?\s+(?:a|the|our)?\s*model|epochs?|learning\s+rate|batch\s+size|neural\s+network|fine-?tun(?:e|ed|ing)|optimizer|gradient\s+descent|loss\s+function)\b/gi,
  );
  return (signals?.length ?? 0) >= 3;
}

export function runReproducibilityChecks(
  content: string,
  settings: ReproducibilitySettings,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!settings.enabled || !content) return diagnostics;

  const codeFindings = checkCodeLinkImpl(content);
  const machineLearning = looksLikeMachineLearning(content);

  if (settings.checkCodeLink) diagnostics.push(...codeFindings);
  if (settings.checkDatasetLink) diagnostics.push(...checkDatasetLinkImpl(content));
  // A license only matters once code is actually released.
  if (settings.checkLicenseMentioned && codeFindings.length === 0)
    diagnostics.push(...checkLicenseMentionedImpl(content));
  if (!machineLearning) return diagnostics;
  if (settings.checkHyperparameters)
    diagnostics.push(...checkHyperparametersImpl(content));
  if (settings.checkHardwareDetails)
    diagnostics.push(...checkHardwareDetailsImpl(content));
  if (settings.checkRandomSeeds) diagnostics.push(...checkRandomSeedsImpl(content));
  if (settings.checkEvaluationMetrics)
    diagnostics.push(...checkEvaluationMetricsImpl(content));

  return diagnostics;
}
