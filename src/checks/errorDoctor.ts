import type { Diagnostic, ErrorDoctorSettings } from "../types";

interface ErrorPattern {
  regex: RegExp;
  title: string;
  explanation: string;
  getSuggestion: (
    match: RegExpExecArray,
    contextLines: string[],
    lineNumber: number,
  ) => string;
  getFix: (
    match: RegExpExecArray,
    contextLines: string[],
    lineNumber: number,
  ) => { find: string; replace: string } | null;
}

function makeDiagnostic(
  line: number,
  message: string,
  detail: string,
  suggestion: string,
  code: string,
  severity: "error" | "warning" = "error",
  replacements?: string[],
): Diagnostic {
  return {
    file: "check",
    line,
    column: 1,
    severity,
    source: "latex" as Diagnostic["source"],
    message,
    detail,
    suggestion,
    code,
    replacements,
  };
}

function extractContextLines(output: string, errorLine: number): string[] {
  const lines = output.split("\n");
  const start = Math.max(0, errorLine - 3);
  const end = Math.min(lines.length, errorLine + 3);
  return lines.slice(start, end).map((l) => l.trim());
}

const errorPatterns: ErrorPattern[] = [
  {
    regex: /!?\s*Missing\s+\$\s+inserted/i,
    title: "Missing $ inserted",
    explanation:
      "LaTeX encountered a math-mode command (like _ or ^) outside of math mode. The underscore _ or caret ^ can only be used inside math environments ($...$, \\[...\\], \\begin{equation}...\\end{equation}). In normal text, these characters need to be escaped as \\_ and \\^{}.",
    getSuggestion: (_m, _cl, _ln) =>
      "Possible fixes:\n" +
      "  1. Wrap the text in math mode: $model\\_name$\n" +
      "  2. Escape the underscore: model\\_name\n" +
      "  3. Use \\textsubscript{...} or \\textsuperscript{...} for sub/superscripts in text",
    getFix: (_m, contextLines, lineNumber) => {
      for (const line of contextLines) {
        const underscoreMatch = line.match(/(\w+)_(\w+)/);
        if (underscoreMatch) {
          const full = underscoreMatch[0];
          return {
            find: full,
            replace: `${underscoreMatch[1]}\\_${underscoreMatch[2]}`,
          };
        }
      }
      return null;
    },
  },
  {
    regex: /!?\s*Undefined\s+control\s+sequence\b/i,
    title: "Undefined control sequence",
    explanation:
      "LaTeX does not recognize a command you used. This usually means you misspelled a command name, forgot to load a required package, or used a command that doesn't exist.",
    getSuggestion: (_m, contextLines) => {
      // TeX prints the source up to the failing command on the "l.<n>" line.
      const sourceLine = contextLines.find((line) => /^l\.\d+/.test(line));
      const cmdMatch = sourceLine?.match(/\\[a-zA-Z@]+(?=[^\\]*$)/);
      const cmd = cmdMatch ? cmdMatch[0] : "(unknown)";
      return (
        `Possible fixes for undefined command ${cmd}:\n` +
        `  1. Check the spelling: did you mean a similar command?\n` +
        `  2. Load the required package: \\usepackage{...}\n` +
        `  3. If it's a custom command, ensure \\newcommand{\\${cmd.slice(1)}}{...} is defined before use`
      );
    },
    getFix: (_m, _cl, _ln) => null,
  },
  {
    regex: /!?\s*Missing\s+\\begin\s*\{document\}/i,
    title: "Missing \\begin{document}",
    explanation:
      "LaTeX reached the end of your document without finding \\begin{document}. Everything before \\begin{document} is the preamble, where only \\documentclass, \\usepackage, and definitions are allowed. Your actual content must go after \\begin{document}.",
    getSuggestion: () =>
      "Possible fixes:\n" +
      "  1. Add \\begin{document} after your preamble commands\n" +
      "  2. Check that \\begin{document} is not commented out\n" +
      "  3. Ensure no stray text appears in the preamble before \\begin{document}",
    getFix: (_m, _cl, lineNumber) => null,
  },
  {
    regex: /!?\s*(?:LaTeX\s+)?Error:\s*File\s+`([^']+)'\s+not\s+found/i,
    title: "File not found",
    explanation:
      "LaTeX cannot find a file that was requested via \\input, \\include, \\includegraphics, \\bibliography, or similar commands. The file may not exist, may be in a different directory, or the filename may be misspelled.",
    getSuggestion: (match) => {
      const filename = match[1] || "(unknown)";
      return (
        `Possible fixes for missing file "${filename}":\n` +
        `  1. Check the filename spelling (case-sensitive on some systems)\n` +
        `  2. Ensure the file exists in the project directory\n` +
        `  3. Use the correct path: e.g., \\includegraphics{figures/${filename}}\n` +
        `  4. Create the file if it doesn't exist yet`
      );
    },
    getFix: (_m, _cl, _ln) => null,
  },
  {
    regex: /!?\s*LaTeX\s+Error:\s*(?:Unknown|Missing)\s+package\b/i,
    title: "Package error",
    explanation:
      "LaTeX cannot find or load a requested package. Either the package is not installed, the name is misspelled, or there's a conflict between packages.",
    getSuggestion: (match) => {
      const pkgMatch = match.input.match(/\\usepackage\s*\{([^}]+)\}/);
      const pkg = pkgMatch ? pkgMatch[1] : "(unknown)";
      return (
        `Possible fixes for package "${pkg}":\n` +
        `  1. Check the package name spelling\n` +
        `  2. Install the package: tlmgr install ${pkg}\n` +
        `  3. Some packages are included in others; check if ${pkg} is part of another package\n` +
        `  4. Add \\usepackage{${pkg}} in the correct order in your preamble`
      );
    },
    getFix: (_m, _cl, _ln) => null,
  },
  {
    regex: /!?\s*Runaway\s+argument/i,
    title: "Runaway argument",
    explanation:
      "A command or environment has an argument that is not properly closed. This typically happens when a { is not matched by a closing }, or when a \\verb command spans a line break.",
    getSuggestion: () =>
      "Possible fixes:\n" +
      "  1. Check for missing closing braces } in the previous lines\n" +
      "  2. Ensure \\verb|...| does not contain line breaks\n" +
      "  3. Look for \\begin{...} without a matching \\end{...}\n" +
      "  4. Check that the argument to \\section{...}, \\caption{...}, etc. has balanced braces",
    getFix: (_m, contextLines, lineNumber) => {
      for (const line of contextLines) {
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        if (opens > closes) {
          return {
            find: line.trim(),
            replace: line.trim() + "\n}",
          };
        }
      }
      return null;
    },
  },
  {
    regex: /!?\s*(?:This\s+)?(?:M|m)issing\s+number,\s+treated\s+as\s+zero/i,
    title: "Missing number, treated as zero",
    explanation:
      "LaTeX expected a number as an argument to a command but found something else. Common causes: an empty or invalid \\hspace{}\\vspace{}, a missing length in \\rule{}{}, or a bad argument to a \\setlength or \\addtolength command.",
    getSuggestion: () =>
      "Possible fixes:\n" +
      "  1. Check the previous line for empty length arguments like \\hspace{} or \\vspace{}\n" +
      "  2. Ensure \\rule{width}{height} has both arguments specified\n" +
      "  3. Check all \\setlength and \\addtolength commands have valid numeric values\n" +
      "  4. Look for missing \\ before a length command like textwidth (should be \\textwidth)",
    getFix: (_m, contextLines, lineNumber) => null,
  },
  {
    regex: /!?\s*Paragraph ended before\s+([^\s]+)\s+was\s+complete/i,
    title: "Unterminated command",
    explanation:
      "A LaTeX command expected its argument to end on the same line but found a blank line or paragraph break instead. Commands like \\caption, \\section, \\textbf cannot contain a \\par or blank line in their argument.",
    getSuggestion: (match) => {
      // TeX names the command with its backslash, e.g. "\\caption".
      const cmd = (match[1] || "(unknown)").replace(/^\\/, "");
      return (
        `Possible fixes for \\${cmd}:\n` +
        `  1. Remove any blank lines inside the argument of \\${cmd}{...}\n` +
        `  2. Use \\protect\\${cmd} if the command is inside a moving argument (\\caption, \\section)\n` +
        `  3. If you need a line break inside, use \\\\ or \\newline instead of a blank line`
      );
    },
    getFix: (_m, contextLines, lineNumber) => null,
  },
  {
    regex: /!?\s*Undefined\s+environment\s+(?:'([^']+)'|([^\s]+))/i,
    title: "Undefined environment",
    explanation:
      "You used \\begin{something} but LaTeX doesn't know the '{something}' environment. This could be a misspelled environment name or you need to load a package that provides it.",
    getSuggestion: (match) => {
      const env = match[1] || match[2] || "(unknown)";
      return (
        `Possible fixes for environment "${env}":\n` +
        `  1. Check the spelling of the environment name\n` +
        `  2. Load a package that provides it: e.g., \\usepackage{amsmath} for {align}\n` +
        `  3. Define it yourself: \\newenvironment{${env}}{...}{...}\n` +
        `  4. Use a different environment that exists`
      );
    },
    getFix: (_m, _cl, _ln) => null,
  },
  {
    regex: /!?\s*Option\s+clash\s+for\s+package/i,
    title: "Option clash for package",
    explanation:
      "A package was loaded twice with conflicting options. The first \\usepackage command loaded the package with certain options, and a subsequent \\usepackage tries to load it with different options.",
    getSuggestion: (match) => {
      const pkgMatch = match.input
        .slice(match.index)
        .match(/Option\s+clash\s+for\s+package\s+([^\s.]+)/i);
      const pkg = pkgMatch ? pkgMatch[1] : "(unknown)";
      return (
        `Possible fixes for package "${pkg}":\n` +
        `  1. Load the package only once with all needed options: \\usepackage[opt1,opt2]{${pkg}}\n` +
        `  2. Remove duplicate \\usepackage commands for ${pkg}\n` +
        `  3. Use \\PassOptionsToPackage{option}{${pkg}} before the first \\usepackage`
      );
    },
    getFix: (_m, _cl, _ln) => null,
  },
  {
    regex:
      /!?\s*(?:Extra|Missing)\s+(?:aligned|\\right|\\left|\\big|\\bigl|\\bigr|\\bigm)/i,
    title: "Mismatched brackets",
    explanation:
      "LaTeX found unmatched \\left...\\right pairs or delimiters. Every \\left must be paired with a \\right of the same type on the same line (or group).",
    getSuggestion: () =>
      "Possible fixes:\n" +
      "  1. Ensure every \\left( has a matching \\right)\n" +
      "  2. Check that \\left\\{ has \\right\\} (braces need escaping)\n" +
      "  3. Use \\right. or \\left. for invisible delimiters\n" +
      "  4. Check for unmatched brackets in the equation",
    getFix: (_m, _cl, _ln) => null,
  },
  {
    regex: /!?\s*TeX\s+capacity\s+exceeded/i,
    title: "TeX capacity exceeded",
    explanation:
      "LaTeX ran out of memory or processing capacity. This usually indicates an infinite loop, a recursive macro, or a very large document element like an oversized table or image.",
    getSuggestion: () =>
      "Possible fixes:\n" +
      "  1. Look for recursive definitions in your custom commands\n" +
      "  2. Reduce the size of large tables or figures\n" +
      "  3. Split the document into smaller files with \\include\n" +
      "  4. Add 'extra_mem_top' and 'extra_mem_bot' to your TeX configuration\n" +
      "  5. Check for infinite loops in \\@for or \\whiledo loops",
    getFix: (_m, _cl, _ln) => null,
  },
  {
    regex: /!?\s*(?:T|t)oo\s+many\s+unprocessed\s+(?:float|table|figure)s/i,
    title: "Too many unprocessed floats",
    explanation:
      "There are too many figures or tables waiting to be placed. LaTeX has limited float storage, and if many floats are defined without being placed, it runs out of room.",
    getSuggestion: () =>
      "Possible fixes:\n" +
      "  1. Use [htbp] placement specifiers: \\begin{figure}[htbp]\n" +
      "  2. Add \\clearpage or \\newpage to flush pending floats\n" +
      "  3. Reduce the number of figures/tables near each other\n" +
      "  4. Use \\usepackage{morefloats} to increase float capacity",
    getFix: (_m, _cl, _ln) => null,
  },
];

export interface ErrorDoctorResult {
  diagnostics: Diagnostic[];
  explain: string;
  fixes: { line: number; find: string; replace: string }[];
}

export function analyzeCompileOutput(
  output: string,
  sourceContent: string,
  settings: ErrorDoctorSettings,
): ErrorDoctorResult {
  const result: ErrorDoctorResult = {
    diagnostics: [],
    explain: "",
    fixes: [],
  };

  if (!settings.enabled || !output) return result;

  const sourceLines = sourceContent.split("\n");
  const outputLines = output.split("\n");

  for (const pattern of errorPatterns) {
    pattern.regex.lastIndex = 0;
    const match = pattern.regex.exec(output);
    if (!match) continue;

    const errorLineIndex = outputLines.findIndex((l) => pattern.regex.test(l));

    let lineNumber = 1;
    const lineMatch = output.match(/l\.(\d+)/);
    if (lineMatch) {
      lineNumber = parseInt(lineMatch[1], 10);
    }

    const contextLines = extractContextLines(output, errorLineIndex);

    if (settings.explainErrors) {
      result.diagnostics.push(
        makeDiagnostic(
          lineNumber,
          pattern.title,
          `LaTeX error: ${match[0].trim()}\n\n${pattern.explanation}`,
          "",
          pattern.title,
          "error",
        ),
      );
    }

    if (settings.suggestFixes) {
      const suggestion = pattern.getSuggestion(match, contextLines, lineNumber);
      const lastDiag = result.diagnostics[result.diagnostics.length - 1];
      if (lastDiag) {
        lastDiag.suggestion = suggestion;
      }
    }

    if (settings.autoFixCommon) {
      const fix = pattern.getFix(match, contextLines, lineNumber);
      if (fix) {
        result.fixes.push({
          line: lineNumber,
          find: fix.find,
          replace: fix.replace,
        });
        const fixDiag = makeDiagnostic(
          lineNumber,
          `Auto-fix available: ${pattern.title}`,
          `One-click fix available`,
          `Replace "${fix.find}" with "${fix.replace}"`,
          "auto-fix",
          "warning",
        );
        fixDiag.replacements = [fix.replace];
        result.diagnostics.push(fixDiag);
      }
    }
  }

  return result;
}
