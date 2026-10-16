import type { Diagnostic, PdfComplianceSettings } from "../types";

function findLine(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function countWords(text: string): number {
  return text.split(/[\s\n]+/).filter(Boolean).length;
}

function makeDiagnostic(
  line: number,
  message: string,
  detail: string,
  suggestion?: string,
  severity: "error" | "warning" = "warning",
): Diagnostic {
  return {
    file: "check",
    line,
    column: 1,
    severity,
    source: "pdf-compliance" as Diagnostic["source"],
    message,
    detail,
    suggestion,
  };
}

function checkPageCount(
  compileOutput: string,
  content: string,
  maxPages: number,
): Diagnostic[] {
  const diag: Diagnostic[] = [];
  const pageMatch = compileOutput.match(/Output written on .+ \((\d+) pages?/);
  if (!pageMatch) return diag;

  const pageCount = parseInt(pageMatch[1], 10);
  if (pageCount > maxPages) {
    diag.push(
      makeDiagnostic(
        1,
        `Paper is ${pageCount} pages (limit: ${maxPages})`,
        `Your compiled PDF is ${pageCount} pages, which exceeds the ${maxPages}-page limit. This may cause submission rejection.`,
        `Consider tightening figures, reducing margins (\\usepackage[margin=1in]{geometry}), or condensing text to fit within ${maxPages} pages.`,
        "error",
      ),
    );
  }
  return diag;
}

function checkUnreferencedFigures(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];

  const figureLabels: { label: string; line: number }[] = [];
  const labelRegex = /\\label\s*\{([^}]*fig[^}]*)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = labelRegex.exec(content)) !== null) {
    figureLabels.push({ label: match[1], line: findLine(content, match.index) });
  }

  const figureRefs: { label: string; line: number }[] = [];
  const refRegex = /\\ref\s*\{([^}]*fig[^}]*)\}/gi;
  while ((match = refRegex.exec(content)) !== null) {
    figureRefs.push({ label: match[1], line: findLine(content, match.index) });
  }

  const refdLabels = new Set(figureRefs.map((r) => r.label));
  for (const fl of figureLabels) {
    if (!refdLabels.has(fl.label)) {
      diag.push(
        makeDiagnostic(
          fl.line,
          `Figure "${fl.label}" is never referenced`,
          `Label "${fl.label}" is defined (\\label{${fl.label}}) but never referenced with \\ref{} in the text.`,
          `Either add \\ref{${fl.label}} in the text describing this figure, or remove the figure if it is unnecessary.`,
        ),
      );
    }
  }

  if (figureLabels.length === 0) {
    const figureEnvs = content.match(/\\begin\s*\{figure\}/g);
    if (figureEnvs && figureEnvs.length > 0) {
      diag.push(
        makeDiagnostic(
          1,
          `${figureEnvs.length} figure(s) found but no \\label{fig:...} detected`,
          `${figureEnvs.length} \\begin{figure} environments exist, but none have a \\label{fig:...} for referencing.`,
          "Add \\label{fig:description} inside each figure environment so you can reference it with \\ref{fig:description}.",
        ),
      );
    }
  }

  return diag;
}

function checkUncitedCitations(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];

  const bibKeys: string[] = [];
  const bibitemRegex = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = bibitemRegex.exec(content)) !== null) {
    bibKeys.push(match[1].trim());
  }

  const citedKeys = new Set<string>();
  const citeRegex = /\\cite(?:[tp]?\*?)?\{([^}]+)\}/g;
  while ((match = citeRegex.exec(content)) !== null) {
    for (const k of match[1].split(",").map((s) => s.trim())) {
      citedKeys.add(k);
    }
  }

  if (bibKeys.length === 0) return diag;

  for (const key of bibKeys) {
    if (!citedKeys.has(key)) {
      const line = findLine(content, content.indexOf(`\\bibitem`));
      diag.push(
        makeDiagnostic(
          line,
          `Citation "${key}" is in bibliography but never cited`,
          `Bibliography entry "${key}" is defined (\\bibitem{${key}}) but never referenced with \\cite{${key}} in the text.`,
          `Either cite \\cite{${key}} in the relevant section, or remove the unused bibliography entry.`,
        ),
      );
    }
  }

  return diag;
}

function checkSectionsWithNoCitations(content: string): Diagnostic[] {
  const diag: Diagnostic[] = [];

  const sectionRegex =
    /\\section\s*\{([^}]+)\}\s*([\s\S]*?)(?=\\section\s*\{|\\bibliography|\\end\s*\{document\}|\\appendix)/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    const sectionName = match[1];
    const sectionBody = match[2];
    const line = findLine(content, match.index);

    // Sections that report the paper's own work rarely cite anyone.
    if (
      /abstract|result|discussion|conclusion|summary|acknowledg|references|appendix|limitation|threats|future work|availability|declaration|evaluation/i.test(
        sectionName,
      )
    )
      continue;

    const citeCount = (sectionBody.match(/\\cite(?:[tp]?\*?)?\{[^}]*\}/g) || []).length;
    if (citeCount === 0) {
      diag.push(
        makeDiagnostic(
          line,
          `Section "${sectionName}" has no citations`,
          `"${sectionName}" has no \\cite{} at all.`,
          `Review the section and add \\cite{...} references to support claims, methods, or related approaches.`,
        ),
      );
    }
  }

  return diag;
}

function checkAbstractWordCount(content: string, maxWords: number): Diagnostic[] {
  const diag: Diagnostic[] = [];

  let abstractText = "";
  let abstractLine = 1;

  const envMatch = content.match(
    /\\begin\s*\{abstract\}\s*([\s\S]*?)\\end\s*\{abstract\}/,
  );
  const cmdMatch = content.match(/\\abstract\s*\{([^}]+)\}/);

  if (envMatch) {
    abstractText = envMatch[1];
    abstractLine = findLine(content, envMatch.index!);
  } else if (cmdMatch) {
    abstractText = cmdMatch[1];
    abstractLine = findLine(content, cmdMatch.index!);
  }

  if (!abstractText) return diag;

  const cleaned = abstractText
    .replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/[{}]/g, "");
  const wordCount = countWords(cleaned);

  if (wordCount > maxWords) {
    diag.push(
      makeDiagnostic(
        abstractLine,
        `Abstract is ${wordCount} words (recommended max: ${maxWords})`,
        `The abstract contains ${wordCount} words, exceeding the recommended maximum of ${maxWords}. Many conferences enforce strict word limits.`,
        `Trim the abstract to ${maxWords} words or fewer. Focus on problem, method, key result, and contribution. Omit citations, equations, and detailed descriptions.`,
        "warning",
      ),
    );
  }

  return diag;
}

function checkType3Fonts(compileOutput: string): Diagnostic[] {
  const diag: Diagnostic[] = [];

  const type3Match = compileOutput.match(/Type\s*3/i);
  if (type3Match) {
    const line = findLine(compileOutput, type3Match.index!);
    diag.push(
      makeDiagnostic(
        line,
        "PDF contains Type 3 fonts",
        "Type 3 fonts (bitmap fonts) were detected in the compiled PDF. Many publishers/conferences require Type 1 or TrueType fonts. Type 3 fonts appear blurry when zoomed.",
        `Add \\usepackage{cmbright} or \\usepackage{lmodern} to your preamble, or ensure all packages use outline fonts. Use \\usepackage[T1]{fontenc} and check with \\usepackage{type1ec}.`,
        "error",
      ),
    );
  }

  return diag;
}

export function runPdfComplianceChecks(
  content: string,
  compileOutput: string,
  settings: PdfComplianceSettings,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!settings.enabled || !content) return diagnostics;

  if (settings.checkPageCount && compileOutput) {
    diagnostics.push(...checkPageCount(compileOutput, content, settings.maxPages));
  }

  if (settings.checkUnreferencedFigures) {
    diagnostics.push(...checkUnreferencedFigures(content));
  }

  if (settings.checkUncitedCitations) {
    diagnostics.push(...checkUncitedCitations(content));
  }

  if (settings.checkSectionsWithNoCitations) {
    diagnostics.push(...checkSectionsWithNoCitations(content));
  }

  if (settings.checkType3Fonts && compileOutput) {
    diagnostics.push(...checkType3Fonts(compileOutput));
  }

  if (settings.checkAbstractWordCount) {
    diagnostics.push(...checkAbstractWordCount(content, settings.maxAbstractWords));
  }

  return diagnostics;
}
