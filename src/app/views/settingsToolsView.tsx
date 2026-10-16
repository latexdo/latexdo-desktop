import { getSetting } from "../../features/settings/settings";
import type { AppCtx } from "../appContext";

export function renderSettingsSectionHeading3(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Conference / Journal Submission Checker</strong>
        <span>
          Validate your manuscript against conference and journal submission guidelines.
        </span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable conference checker</strong>
          <small>Run submission-format checks on your LaTeX source.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.conferenceCheckerEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              conferenceCheckerEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row">
        <span>
          <strong>Select template</strong>
          <small>Choose the target venue template.</small>
        </span>
        <select
          value={
            settings.conferenceTemplate === "custom"
              ? "custom"
              : settings.conferenceTemplate
          }
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              conferenceTemplate: event.target.value,
            }))
          }
        >
          <option value="ieee">IEEE</option>
          <option value="acm">ACM</option>
          <option value="springer">Springer</option>
          <option value="elsevier">Elsevier</option>
          <option value="neurips">NeurIPS</option>
          <option value="cvpr">CVPR</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      {settings.conferenceTemplate === "custom" ? (
        <div className="settings-row settings-row-stack">
          <span>
            <strong>Custom template</strong>
            <small>Describe your template or paste document class.</small>
          </span>
          <input
            type="text"
            value={settings.conferenceChecker_customTemplate}
            onChange={(event) =>
              setSettings((c) => ({
                ...c,
                conferenceChecker_customTemplate: event.target.value,
              }))
            }
            placeholder="e.g., \\documentclass[twocolumn]{article}"
          />
        </div>
      ) : null}

      <div
        className="settings-section-heading"
        style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}
      >
        <strong>Checks to perform</strong>
      </div>

      {[
        ["checkMargins", "Margins", "Check for incorrect margin settings."],
        [
          "checkFontSize",
          "Font size",
          "Warn if font size does not match template requirements.",
        ],
        [
          "checkAbstractLength",
          "Abstract length",
          "Flag abstracts that exceed the word limit.",
        ],
        [
          "checkKeywords",
          "Missing keywords",
          "Ensure the document has keywords defined.",
        ],
        [
          "checkFigureReferences",
          "Figure references",
          "Find figures that are not referenced in the text.",
        ],
        [
          "checkTableReferences",
          "Table references",
          "Find tables that are not referenced in the text.",
        ],
        [
          "checkBibliographyStyle",
          "Bibliography style",
          "Verify bibliography style matches the template.",
        ],
        ["checkPageLimit", "Page limit", "Rough check for going over the page limit."],
        [
          "checkAuthorInfo",
          "Author information",
          "Check for missing author name, affiliation, or email.",
        ],
        [
          "checkAnonymousReview",
          "Anonymous review",
          "Detect potential author-identifying information for double-blind submissions.",
        ],
        [
          "checkFigureResolution",
          "Figure resolution",
          "Check included image formats and warn about low-resolution formats.",
        ],
        [
          "checkEmbeddedFonts",
          "Embedded fonts",
          "Basic check for font usage that may cause PDF issues.",
        ],
        [
          "checkCompiler",
          "Compiler selection",
          "Check if selected compiler is appropriate for used packages.",
        ],
      ].map(([key, label, desc]) => (
        <label key={key} className="settings-row settings-toggle">
          <span>
            <strong>{label}</strong>
            <small>{desc}</small>
          </span>
          <input
            type="checkbox"
            checked={getSetting(key, settings)}
            onChange={(event) =>
              setSettings((c) => ({ ...c, [key]: event.target.checked }))
            }
          />
        </label>
      ))}
    </>
  );
}

export function renderSettingsSectionHeading4(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Smart Citation Assistant</strong>
        <span>
          Detect missing citations, unused references, broken links, and more.
        </span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable citation assistant</strong>
          <small>Run citation-related checks on your LaTeX source.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.citationAssistantEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              citationAssistantEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {[
        [
          "detectMissingCitations",
          "Detect missing citations",
          "Find paragraphs that make technical claims but have no citations.",
        ],
        [
          "detectUnusedEntries",
          "Detect unused entries",
          "Check for BibTeX entries that are never cited.",
        ],
        [
          "detectDuplicateReferences",
          "Detect duplicate references",
          "Find the same paper cited under different keys.",
        ],
        [
          "detectBrokenLinks",
          "Detect broken links",
          "Check for malformed DOI, arXiv, and URL links.",
        ],
        [
          "suggestCitationKeys",
          "Suggest citation keys",
          "Auto-suggest citations for sentences with factual claims.",
        ],
        [
          "importMetadataSources",
          "Import from metadata sources",
          "Enable DOI/arXiv metadata import.",
        ],
        [
          "warnOldCitations",
          "Warn about old citations",
          "Flag citations older than 5 years and suggest newer surveys.",
        ],
      ].map(([key, label, desc]) => (
        <label key={key} className="settings-row settings-toggle">
          <span>
            <strong>{label}</strong>
            <small>{desc}</small>
          </span>
          <input
            type="checkbox"
            checked={getSetting(key, settings)}
            onChange={(event) =>
              setSettings((c) => ({ ...c, [key]: event.target.checked }))
            }
          />
        </label>
      ))}
    </>
  );
}

export function renderSettingsSectionHeading5(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Research Structure Assistant</strong>
        <span>
          Check whether your paper's structure meets academic writing standards.
        </span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable structure assistant</strong>
          <small>Run structure quality checks on your LaTeX source.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.structureAssistantEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              structureAssistantEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {[
        [
          "checkAbstractStructure",
          "Abstract structure",
          "Check if abstract includes problem, method, result, and contribution.",
        ],
        [
          "checkIntroductionStructure",
          "Introduction structure",
          "Check if introduction has motivation, gap, and contribution.",
        ],
        [
          "checkRelatedWorkLength",
          "Related work length",
          "Warn if the related work section is too short.",
        ],
        [
          "checkMethodReproducibility",
          "Method reproducibility",
          "Check for reproducibility details in the method section.",
        ],
        [
          "checkResultsDiscussion",
          "Results discussion",
          "Ensure results are accompanied by discussion and analysis.",
        ],
        [
          "checkConclusionClaims",
          "Conclusion claims",
          "Warn if conclusion introduces new claims not supported earlier.",
        ],
      ].map(([key, label, desc]) => (
        <label key={key} className="settings-row settings-toggle">
          <span>
            <strong>{label}</strong>
            <small>{desc}</small>
          </span>
          <input
            type="checkbox"
            checked={getSetting(key, settings)}
            onChange={(event) =>
              setSettings((c) => ({ ...c, [key]: event.target.checked }))
            }
          />
        </label>
      ))}
    </>
  );
}

export function renderSettingsSectionHeading6(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Reproducibility Checklist</strong>
        <span>
          Check that your paper includes all information needed for reproducibility.
        </span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable reproducibility checks</strong>
          <small>
            Run checks for code, data, and experiment reproducibility details.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.reproducibilityEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              reproducibilityEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {[
        [
          "checkCodeLink",
          "Code availability",
          "Ensure a link to source code is provided (e.g., GitHub, Zenodo).",
        ],
        [
          "checkDatasetLink",
          "Dataset availability",
          "Check that datasets are linked or their availability is mentioned.",
        ],
        [
          "checkLicenseMentioned",
          "License information",
          "Verify the license for code/data is stated.",
        ],
        [
          "checkHyperparameters",
          "Hyperparameters",
          "Confirm hyperparameters are listed for ML experiments.",
        ],
        [
          "checkHardwareDetails",
          "Hardware details",
          "Check that GPU/CPU and computing resources are described.",
        ],
        [
          "checkRandomSeeds",
          "Random seeds",
          "Ensure random seeds are mentioned for reproducibility.",
        ],
        [
          "checkEvaluationMetrics",
          "Evaluation metrics",
          "Check that metrics are defined and computation is described.",
        ],
      ].map(([key, label, desc]) => (
        <label key={key} className="settings-row settings-toggle">
          <span>
            <strong>{label}</strong>
            <small>{desc}</small>
          </span>
          <input
            type="checkbox"
            checked={getSetting(key, settings)}
            onChange={(event) =>
              setSettings((c) => ({ ...c, [key]: event.target.checked }))
            }
          />
        </label>
      ))}
    </>
  );
}

export function renderSettingsSectionHeading7(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Acronym & Glossary Manager</strong>
        <span>
          Automatically detect acronym definitions, duplicates, and usage issues.
        </span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable acronym manager</strong>
          <small>Run acronym consistency checks on your LaTeX source.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.acronymManagerEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              acronymManagerEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {[
        [
          "checkUndefinedAcronym",
          "Undefined acronyms",
          "Warn when an acronym is used without prior definition.",
        ],
        [
          "checkDuplicateDefinition",
          "Duplicate definitions",
          "Warn if the same acronym is defined multiple times.",
        ],
        [
          "checkUnusedAcronym",
          "Unused acronyms",
          "Warn if an acronym is defined but never used again.",
        ],
        [
          "checkConflictingDefinitions",
          "Conflicting definitions",
          "Warn if different full forms map to the same acronym.",
        ],
      ].map(([key, label, desc]) => (
        <label key={key} className="settings-row settings-toggle">
          <span>
            <strong>{label}</strong>
            <small>{desc}</small>
          </span>
          <input
            type="checkbox"
            checked={getSetting(key, settings)}
            onChange={(event) =>
              setSettings((c) => ({ ...c, [key]: event.target.checked }))
            }
          />
        </label>
      ))}
    </>
  );
}

export function renderSettingsSectionHeading8(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>LaTeX Error Doctor</strong>
        <span>Smart error explanations with one-click fix suggestions.</span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable Error Doctor</strong>
          <small>
            Analyze compile output and provide intelligent error explanations.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.errorDoctorEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              errorDoctorEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {[
        [
          "explainErrors",
          "Explain errors",
          "Show human-readable explanations for LaTeX errors.",
        ],
        [
          "suggestFixes",
          "Suggest fixes",
          "Provide actionable fix suggestions for common errors.",
        ],
        [
          "autoFixCommon",
          "Auto-fix common errors",
          "Automatically apply one-click fixes for simple errors (e.g., underscore escaping).",
        ],
      ].map(([key, label, desc]) => (
        <label key={key} className="settings-row settings-toggle">
          <span>
            <strong>{label}</strong>
            <small>{desc}</small>
          </span>
          <input
            type="checkbox"
            checked={getSetting(key, settings)}
            onChange={(event) =>
              setSettings((c) => ({ ...c, [key]: event.target.checked }))
            }
          />
        </label>
      ))}
    </>
  );
}

export function renderSettingsSectionHeading9(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Figure → TikZ Converter</strong>
        <span>Upload images and automatically generate editable TikZ code.</span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable TikZ converter</strong>
          <small>Show the Figure → TikZ converter button in the activity bar.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.tikzConverterEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              tikzConverterEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Auto-open on image copy</strong>
          <small>
            Automatically open converter when an image is detected in clipboard.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.tikzConverterAutoOpen}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              tikzConverterAutoOpen: event.target.checked,
            }))
          }
        />
      </label>
    </>
  );
}

export function renderSettingsSectionHeading10(ctx: AppCtx) {
  const { setSettings, settings } = ctx;
  return (
    <>
      <div className="settings-section-heading">
        <strong>Notation Manager</strong>
        <span>
          Detect, define, and manage mathematical notation in your LaTeX documents.
        </span>
      </div>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Enable notation manager</strong>
          <small>Show the Notation Manager button in the activity bar.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.notationManagerEnabled}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              notationManagerEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Detect notation</strong>
          <small>Scan documents for mathematical symbols and notation.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.detectNotation}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              detectNotation: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Detect notation conflicts</strong>
          <small>Flag symbols that are visually or semantically similar.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.detectNotationConflicts}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              detectNotationConflicts: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>
          <strong>Detect undefined notation</strong>
          <small>Warn when a symbol is used without a preceding definition.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.detectUndefinedNotation}
          onChange={(event) =>
            setSettings((c) => ({
              ...c,
              detectUndefinedNotation: event.target.checked,
            }))
          }
        />
      </label>
    </>
  );
}
