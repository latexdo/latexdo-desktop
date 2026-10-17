/*
 * The instruction behind "Review": a full peer review of the open paper by
 * the AI agent, grounded in the project's files and shaped by the author's
 * settings (language, native language, strictness, build state, earlier
 * reviews, AI access). It is sent as the user's turn; the agent's system
 * prompt already carries the tools, the researcher profile and the custom
 * dictionary.
 */

import type { AiAccessConfig } from "./aiConfig";

export interface PaperReviewContext {
  projectName: string;
  /** The root .tex file, relative to the project; empty when unknown. */
  rootFile: string;
  engine?: string;
  activeFilePath?: string | null;
  /** Folders of a Research Space, with their roles. */
  researchSpaceFolders?: { name: string; kind: string }[];
  access: AiAccessConfig;
  proofreading?: {
    enabled: boolean;
    language: string;
    motherTongue: string;
    picky: boolean;
  } | null;
  spellCheckLanguages?: string[];
  /** The last build of this session, or null when nothing was built yet. */
  lastBuild?: { ok: boolean; errors: string[]; warningCount: number } | null;
  /** Reviewer comments from an earlier round (Rebuttal mode). */
  previousReviews?: { reviewer?: string; comment: string; response?: string }[];
  /** The author's own notes left in Reviewer mode. */
  annotations?: { filePath: string; excerpt: string; comments: string[] }[];
  hasResearcherProfile?: boolean;
  /** Extra instructions typed by the person, e.g. "focus on the experiments". */
  focus?: string;
}

const maxListed = 15;
const maxCommentChars = 400;

function clip(text: string, max = maxCommentChars): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "en-GB" → "British English (en-GB)"; unknown codes stay as they are. */
export function describeLanguage(code: string): string {
  const trimmed = code.trim();
  if (!trimmed || trimmed === "auto") return "";
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
    const name = names.of(trimmed);
    return name && name !== trimmed ? `${name} (${trimmed})` : trimmed;
  } catch {
    return trimmed;
  }
}

function settingsSection(ctx: PaperReviewContext): string[] {
  const lines: string[] = [];
  const project = ctx.projectName ? `Project "${ctx.projectName}"` : "The open project";
  const projectLine = ctx.rootFile
    ? `- ${project}, root file \`${ctx.rootFile}\`${ctx.engine ? `, built with ${ctx.engine}` : ""}. Start from the root file.`
    : `- ${project}. Find the root file: the one with \\documentclass and \\begin{document}.`;
  lines.push(projectLine);
  if (ctx.researchSpaceFolders?.length) {
    lines.push(
      `- This is a Research Space with folders ${ctx.researchSpaceFolders
        .map((folder) => `"${folder.name}" (${folder.kind})`)
        .join(
          ", ",
        )}. Review the paper folder; treat bibliography and shared folders as supporting material.`,
    );
  }
  if (ctx.activeFilePath && ctx.activeFilePath !== ctx.rootFile) {
    lines.push(
      `- The author has \`${ctx.activeFilePath}\` open. Review the whole paper, not only that file.`,
    );
  }

  const proofreading = ctx.proofreading;
  const language = describeLanguage(proofreading?.language ?? "");
  if (language) {
    lines.push(
      `- Writing language chosen in Settings: ${language}. Judge spelling, grammar and usage against that variant and flag any text that mixes variants.`,
    );
  } else {
    lines.push(
      "- No writing language is fixed in Settings: detect the paper's language and variant, and flag text that mixes variants.",
    );
  }
  const motherTongue = describeLanguage(proofreading?.motherTongue ?? "");
  if (motherTongue) {
    lines.push(
      `- The author's native language is ${motherTongue}. Watch for false friends, calques and article or preposition errors typical of ${motherTongue.replace(/ \(.*\)$/, "")} speakers, and explain those fixes in a few words.`,
    );
  }
  if (proofreading?.picky) {
    lines.push(
      "- The author turned on picky checking: also report style problems (wordiness, weak verbs, hedging, repeated words, overlong sentences), not only errors.",
    );
  }
  const spellLanguages = (ctx.spellCheckLanguages ?? [])
    .map(describeLanguage)
    .filter(Boolean);
  if (spellLanguages.length) {
    lines.push(`- Spell checking runs in: ${spellLanguages.join(", ")}.`);
  }

  const build = ctx.lastBuild;
  if (build === undefined) {
    // Unknown (the \review chat command): the procedure compiles anyway.
  } else if (!build) {
    lines.push("- The paper has not been built in this session yet.");
  } else if (!build.ok || build.errors.length) {
    lines.push(
      `- The last build failed with ${build.errors.length || "some"} error(s)${
        build.errors.length
          ? `, for example: ${build.errors
              .slice(0, 3)
              .map((error) => `"${clip(error, 160)}"`)
              .join("; ")}`
          : ""
      }. The PDF may not match the source.`,
    );
  } else {
    lines.push(
      `- The last build succeeded${build.warningCount ? ` with ${build.warningCount} warning(s)` : " without warnings"}.`,
    );
  }

  if (ctx.hasResearcherProfile && ctx.access.researcherProfile) {
    lines.push(
      "- Your instructions include the author's researcher profile: use it to judge the field and its conventions. Review this paper, not the author's earlier work.",
    );
  }
  if (!ctx.access.bibliography) {
    lines.push(
      "- Bibliography tools are off in Settings → AI: do not call recommend_citations; you can still read .bib files.",
    );
  }
  return lines;
}

function procedureSection(ctx: PaperReviewContext): string[] {
  const steps: string[] = [];
  if (ctx.access.projectFiles) {
    steps.push(
      "Call list_files, then read the root file and every file it pulls in through \\input, \\include, \\subfile or \\import, recursively. Read the .bib files and the sources of figures and tables (.tex, .tikz). Request independent reads together.",
      "Call compile to see the real build state: undefined references and citations, missing files, errors.",
      "Call run_checks for each kind: structure, citations, conference, reproducibility, acronyms, notation and pdf-compliance. Use their findings as evidence, not as the review.",
    );
  } else {
    steps.push(
      'Project file access is off in Settings → AI, so call get_active_document and review only the open file. Say at the top of the review that it covers only that file, and that turning on "Project files" lets you review the whole paper.',
    );
  }
  steps.push(
    "Read everything before you judge. Work out the target venue from \\documentclass, its options and the style files (IEEEtran, acmart, llncs, elsarticle, revtex, neurips_*, icml*, iclr*, aaai*, cvpr, acl…), and the field from the content. If the venue is unclear, review against a strong peer-reviewed venue in that field and say so.",
    "Do not edit any file during the review. The review is a report; changes come afterwards, only when the author asks.",
  );
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

const criteria = `What to assess, as a senior reviewer for that venue would:
- Contribution and novelty: what is new relative to the work the paper itself cites. Judge novelty from the paper and its references; when you rely on your own knowledge of the literature, say so and hedge.
- Soundness: trace every main claim (abstract, introduction, contributions list) to the experiment, proof or analysis that supports it. Check baselines, datasets and splits, seeds and variance, statistical significance, ablations, leakage, and whether conclusions overreach the evidence. For theory, check assumptions, definitions and proof steps.
- Clarity and structure: does the abstract state problem, approach and results? Do the contributions match what is delivered? Are terminology and notation consistent, acronyms defined once, every figure and table referenced and readable from its caption?
- Related work: missing lines of work, unfair or outdated comparisons.
- Reproducibility: data and code availability, hyperparameters, compute, enough detail to rerun.
- Limitations, threats to validity, and ethics or broader impact where the venue expects them.
- Anonymity: if the template or options indicate double-blind review (for example acmart with anonymous or review, or a submission-mode style file), flag author names, acknowledgments, self-revealing citations and non-anonymous links.
- Venue format: page limit, required sections, citation style, as far as the class and style files show them.
- LaTeX quality: undefined or unused labels and citations, \\label placed before \\caption, mixed \\ref and \\cref, hard-coded numbers instead of references, manual spacing (\\\\, \\vspace) used for layout, floats far from their first mention, overfull boxes from the build log.
- References: entries that are cited but missing, or present but never cited, inconsistent fields, preprints that have a published version, missing DOIs.
- Language: grammar, spelling and style under the language settings above.`;

const groundingRules = `Rules:
- Ground every point. Give the location as file and section, with line numbers when you have them, plus a short quote (25 words or fewer).
- Never invent content, numbers, results or references. If you could not read something, say what and why instead of guessing. Keep "the paper does not include X" apart from "I could not find X".
- Be specific: every problem comes with a concrete fix. No generic advice without an instance.
- Be candid and constructive. Order issues by impact on acceptance. No filler praise.
- Write the review in the language the paper is written in.`;

const reportFormat = `Report format (Markdown):
## Review: <paper title>
**Assumed venue:** … · **Field:** … · **Files read:** …

### Summary
Three to five sentences in your own words: the problem, the approach and the main results.

### Recommendation
One of Strong accept, Accept, Weak accept, Borderline, Weak reject, Reject, with a score out of 10 and your confidence (1–5), and the two or three reasons that decide it.

### Strengths

### Major issues
For each: a short title, where it is, why it matters, and the concrete fix.

### Minor issues

### Writing and language

### LaTeX and build

### References

### Questions for the authors

### Revision checklist
Prioritized, as "- [ ] task (location)".

End with one sentence offering to make specific checklist items for the author, each one going through edit approval.`;

function previousReviewsSection(ctx: PaperReviewContext): string {
  const reviews = ctx.previousReviews ?? [];
  if (!reviews.length) return "";
  const listed = reviews
    .slice(0, maxListed)
    .map((review, index) => {
      const who = review.reviewer?.trim() || `Comment ${index + 1}`;
      const response = review.response?.trim()
        ? `\n  Author's response: ${clip(review.response)}`
        : "";
      return `- ${who}: ${clip(review.comment)}${response}`;
    })
    .join("\n");
  const more =
    reviews.length > maxListed ? `\n- … and ${reviews.length - maxListed} more.` : "";
  return `\n\nReviewer comments from the previous round (Rebuttal mode):\n${listed}${more}\nAdd a section "### Previous reviews" after the recommendation: for each comment, say whether the current text addresses it (Addressed, Partly, Not addressed), with evidence.`;
}

function annotationsSection(ctx: PaperReviewContext): string {
  const annotations = (ctx.annotations ?? []).filter((note) => note.comments.length);
  if (!annotations.length) return "";
  const listed = annotations
    .slice(0, maxListed)
    .map(
      (note) =>
        `- ${note.filePath}, at "${clip(note.excerpt, 120)}": ${note.comments.map((comment) => clip(comment, 200)).join(" / ")}`,
    )
    .join("\n");
  return `\n\nNotes the author left in Reviewer mode (take them into account and say where you agree or disagree):\n${listed}`;
}

/** The full review instruction for the agent. */
export function buildPaperReviewPrompt(ctx: PaperReviewContext): string {
  const focus = ctx.focus?.trim()
    ? `\n\nThe author asks you to focus on: ${clip(ctx.focus, 600)}`
    : "";
  return `Review this paper as an expert peer reviewer for the venue it targets, and write the report a demanding but fair senior reviewer would submit.

Context from LatexDo:
${settingsSection(ctx).join("\n")}

How to work:
${procedureSection(ctx).join("\n")}

${criteria}

${groundingRules}${previousReviewsSection(ctx)}${annotationsSection(ctx)}${focus}

${reportFormat}`;
}

/** Chat-visible label for the request; the full prompt only goes to the model. */
export function paperReviewDisplayText(ctx: Pick<PaperReviewContext, "focus">): string {
  return ctx.focus?.trim()
    ? `Review this paper: ${ctx.focus.trim()}`
    : "Review this paper";
}
