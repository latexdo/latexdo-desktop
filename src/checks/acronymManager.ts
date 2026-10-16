import type { Diagnostic, AcronymManagerSettings } from "../types";

function findLine(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function makeDiagnostic(
  line: number,
  message: string,
  detail: string,
  suggestion: string,
  severity: "warning" | "error" = "warning",
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
  };
}

interface AcronymDef {
  acronym: string;
  fullForm: string;
  line: number;
  scope: string;
}

function findSection(content: string, pos: number): string {
  const before = content.substring(0, pos);
  const sectionMatch = before.match(/\\section\s*\*?\s*\{([^}]*)\}\s*$/m);
  return sectionMatch ? sectionMatch[1] : "(preamble/global)";
}

// Commands whose arguments are names, addresses, keys or code, never prose.
const nonProseCommands = [
  "author",
  "affil",
  "affiliation",
  "institute",
  "address",
  "email",
  "orgname",
  "orgdiv",
  "orgaddress",
  "street",
  "city",
  "postcode",
  "state",
  "country",
  "fnm",
  "sur",
  "label",
  "ref",
  "cref",
  "Cref",
  "eqref",
  "autoref",
  "pageref",
  "cite",
  "citep",
  "citet",
  "parencite",
  "textcite",
  "url",
  "href",
  "includegraphics",
  "definecolor",
  "color",
  "textcolor",
  "colorbox",
  "input",
  "include",
  "bibliography",
  "bibliographystyle",
  "usepackage",
  "begin",
  "end",
  "newcommand",
  "renewcommand",
  "texttt",
  "lstinline",
  "verb",
];
const nonProseEnvironments = [
  "equation",
  "align",
  "gather",
  "multline",
  "verbatim",
  "lstlisting",
  "minted",
  "tikzpicture",
  "algorithmic",
  "thebibliography",
];

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/**
 * The document body as a reader sees it, with markup, math, code and
 * author metadata blanked out. Line numbers stay where they were.
 */
export function proseView(content: string): string {
  let text = content;
  const bodyStart = text.indexOf("\\begin{document}");
  if (bodyStart > 0) text = blank(text.slice(0, bodyStart)) + text.slice(bodyStart);
  for (const env of nonProseEnvironments) {
    const pattern = new RegExp(
      `\\\\begin\\{${env}\\*?\\}[\\s\\S]*?\\\\end\\{${env}\\*?\\}`,
      "g",
    );
    text = text.replace(pattern, blank);
  }
  text = text.replace(
    /\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g,
    blank,
  );
  const command = new RegExp(`\\\\(?:${nonProseCommands.join("|")})\\*?`, "g");
  let match: RegExpExecArray | null;
  while ((match = command.exec(text)) !== null) {
    let end = match.index + match[0].length;
    // Skip [options] then blank the {argument} groups that follow.
    for (let groups = 0; groups < 3; groups += 1) {
      while (text[end] === " ") end += 1;
      const open = text[end];
      if (open !== "{" && open !== "[") break;
      const close = open === "{" ? "}" : "]";
      let depth = 0;
      let index = end;
      for (; index < text.length; index += 1) {
        if (text[index] === "\\") {
          index += 1;
        } else if (text[index] === open) {
          depth += 1;
        } else if (text[index] === close && --depth === 0) {
          break;
        }
      }
      end = Math.min(text.length, index + 1);
    }
    text =
      text.slice(0, match.index) +
      blank(text.slice(match.index, end)) +
      text.slice(end);
    command.lastIndex = match.index + 1;
  }
  return text;
}

// Well-known abbreviations nobody expects to be spelled out.
const commonAbbreviations = new Set([
  "PDF",
  "URL",
  "HTML",
  "HTTP",
  "HTTPS",
  "USA",
  "UK",
  "EU",
  "ID",
  "OK",
  "CPU",
  "GPU",
  "RAM",
  "DOI",
  "ISBN",
  "ISSN",
  "PHD",
  "MSC",
  "BSC",
  "CEO",
  "FAQ",
  "PC",
  "TV",
  "AM",
  "PM",
  "UTC",
  "GMT",
  "JSON",
  "XML",
  "CSV",
  "SQL",
  "USB",
  "LATEX",
]);
// Section and item numbers such as IV or XII, not words like ML or CD.
const romanNumeral = /^X{0,3}(?:IX|IV|V?I{0,3})$/;

/** The words before "(ACR)" whose initials spell the acronym, if any. */
function fullFormFor(before: string, acronym: string): string {
  const words = before.trim().split(/\s+/).filter(Boolean).slice(-8);
  const letters = acronym.replace(/[-/]/g, "").toLowerCase();
  for (let count = 1; count <= words.length; count += 1) {
    const candidate = words.slice(-count);
    const initials = candidate.map((word) => word[0]?.toLowerCase() ?? "").join("");
    if (initials === letters) return candidate.join(" ");
  }
  return words.slice(-Math.min(words.length, letters.length)).join(" ");
}

function findAcronymDefinitions(content: string, lineNum: number): AcronymDef[] {
  const defs: AcronymDef[] = [];
  const acronymPattern = /\b([A-Z][a-zA-Z]*)\s*\(([A-Z]{2,}(?:[-\/][A-Z]+)*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = acronymPattern.exec(content)) !== null) {
    const acronym = match[2].trim();
    const lineStart = content.lastIndexOf("\n", match.index) + 1;
    const fullForm = fullFormFor(
      content.slice(Math.max(lineStart - 200, 0), match.index + match[1].length),
      acronym,
    );
    const ln = findLine(content, match.index);
    const scope = findSection(content, match.index);
    defs.push({ acronym, fullForm, line: ln, scope });
  }
  return defs;
}

function checkUndefinedAcronymImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const defs = findAcronymDefinitions(content, 0);
  const definedAcronyms = new Set(defs.map((d) => d.acronym.toUpperCase()));

  const singleAcronymPattern = /\b([A-Z]{2,}(?:[-\/][A-Z]+)*)\b/g;
  const contentWithoutDefs = content.replace(
    /\b([A-Z][a-zA-Z]*)\s*\(([A-Z]{2,}(?:[-\/][A-Z]+)*)\)/g,
    "",
  );

  const usedAcronymsInContent = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = singleAcronymPattern.exec(contentWithoutDefs)) !== null) {
    const acr = match[1].toUpperCase();
    if (
      !/^[A-Z]{2,}$/.test(acr) ||
      commonAbbreviations.has(acr) ||
      romanNumeral.test(acr) ||
      /^[A-F0-9]{6}$/.test(acr) ||
      acr === "THE" ||
      acr === "FOR" ||
      acr === "AND" ||
      acr === "ARE" ||
      acr === "BUT" ||
      acr === "NOT" ||
      acr === "WAS" ||
      acr === "CAN" ||
      acr === "HOW" ||
      acr === "WHY" ||
      acr === "HAS" ||
      acr === "ITS" ||
      acr === "ALL" ||
      acr === "ANY" ||
      acr === "PER" ||
      acr === "VIA" ||
      acr === "THAT" ||
      acr === "THIS" ||
      acr === "FROM" ||
      acr === "WITH" ||
      acr === "THAN" ||
      acr === "HAVE" ||
      acr === "BEEN" ||
      acr === "WERE" ||
      acr === "SHALL" ||
      acr === "WILL" ||
      acr === "MORE" ||
      acr === "SOME"
    ) {
      continue;
    }
    if (!definedAcronyms.has(acr)) {
      usedAcronymsInContent.add(acr);
    }
  }

  const stopWords = new Set([
    "THE",
    "FOR",
    "AND",
    "ARE",
    "BUT",
    "NOT",
    "WAS",
    "CAN",
    "HOW",
    "WHY",
    "HAS",
    "ITS",
    "ALL",
    "ANY",
    "PER",
    "VIA",
    "THAT",
    "THIS",
    "FROM",
    "WITH",
    "THAN",
    "HAVE",
    "BEEN",
    "WERE",
    "SHALL",
    "WILL",
    "MORE",
    "SOME",
    "WHICH",
    "WHAT",
    "WHERE",
    "WHEN",
    "THERE",
    "THEIR",
    "SUCH",
    "BOTH",
    "EACH",
    "FEW",
    "MANY",
    "MUCH",
    "HERE",
    "THEN",
    "ALSO",
    "INTO",
    "OVER",
    "UPON",
    "YOUR",
    "ABOUT",
  ]);

  const undefinedAcronyms = [...usedAcronymsInContent].filter(
    (a) => !stopWords.has(a) && a.length >= 2,
  );

  const contentLines = content.split("\n");
  for (const acr of undefinedAcronyms) {
    for (let i = 0; i < contentLines.length; i++) {
      const lineText = contentLines[i];
      const lineIdx = i + 1;
      if (new RegExp(`\\b${acr}\\b`).test(lineText)) {
        const prevMatch = defs.find((d) => d.acronym.toUpperCase() === acr);
        if (prevMatch) {
          const nextLines = contentLines.slice(i, i + 5).join("\n");
          if (!nextLines.includes(`${acr}`)) continue;
        }
        diagnostics.push(
          makeDiagnostic(
            lineIdx,
            `Acronym "${acr}" used without definition`,
            `"${acr}" is used before it is spelled out.`,
            `Spell it out on first use, e.g. "Full Name (${acr})".`,
            "warning",
          ),
        );
        break;
      }
    }
  }

  return diagnostics;
}

function checkDuplicateDefinitionImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const defs = findAcronymDefinitions(content, 0);

  const acronymMap = new Map<string, AcronymDef[]>();
  for (const def of defs) {
    const key = def.acronym.toUpperCase();
    if (!acronymMap.has(key)) acronymMap.set(key, []);
    acronymMap.get(key)!.push(def);
  }

  for (const [acr, occurrences] of acronymMap) {
    if (occurrences.length > 1) {
      for (let i = 1; i < occurrences.length; i++) {
        diagnostics.push(
          makeDiagnostic(
            occurrences[i].line,
            `Acronym "${acr}" defined multiple times`,
            `"${acr}" was already defined as "${occurrences[0].fullForm} (${occurrences[0].acronym})".`,
            `Remove the duplicate definition. Acronyms should be defined once. Use "${occurrences[0].fullForm} (${occurrences[0].acronym})" as the canonical definition.`,
            "error",
          ),
        );
      }
    }
  }

  return diagnostics;
}

function checkUnusedAcronymImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const defs = findAcronymDefinitions(content, 0);

  for (const def of defs) {
    const acrPattern = new RegExp(`\\b${def.acronym}\\b`, "g");
    const occurrences = content.match(acrPattern);
    const count = occurrences ? occurrences.length : 0;

    if (count <= 1) {
      diagnostics.push(
        makeDiagnostic(
          def.line,
          `Acronym "${def.acronym}" defined but never used again`,
          `"${def.acronym}" (${def.fullForm}) is never used after it is defined.`,
          `Either use "${def.acronym}" later in the document, or remove the definition and write out "${def.fullForm}" in full each time`,
          "warning",
        ),
      );
    }
  }

  return diagnostics;
}

function checkConflictingDefinitionsImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const defs = findAcronymDefinitions(content, 0);

  for (let i = 0; i < defs.length; i++) {
    for (let j = i + 1; j < defs.length; j++) {
      const a = defs[i];
      const b = defs[j];
      const acrMatch = a.acronym.toUpperCase() === b.acronym.toUpperCase();
      const sameForm = a.fullForm.toLowerCase() === b.fullForm.toLowerCase();

      if (acrMatch && !sameForm) {
        diagnostics.push(
          makeDiagnostic(
            b.line,
            `Conflicting definitions for acronym "${a.acronym}"`,
            `"${a.acronym}" was defined as "${a.fullForm}" and also as "${b.fullForm}".`,
            `Standardize on one definition. This conflict could confuse readers who encounter "${a.acronym}" and need to recall which full form was intended.`,
            "error",
          ),
        );
      }

      const sameFullForm = a.fullForm.toLowerCase() === b.fullForm.toLowerCase();
      const differentAcr = a.acronym.toUpperCase() !== b.acronym.toUpperCase();
      if (sameFullForm && differentAcr) {
        diagnostics.push(
          makeDiagnostic(
            b.line,
            `Same full form "${a.fullForm}" has two different acronyms`,
            `"${a.fullForm}" is abbreviated both as "${a.acronym}" and "${b.acronym}".`,
            `Standardize on one acronym for "${a.fullForm}", e.g. always use "${a.acronym}"`,
            "warning",
          ),
        );
      }
    }
  }

  return diagnostics;
}

export function runAcronymChecks(
  content: string,
  settings: AcronymManagerSettings,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!settings.enabled || !content) return diagnostics;
  content = proseView(content);

  if (settings.checkUndefinedAcronym) {
    diagnostics.push(...checkUndefinedAcronymImpl(content));
  }
  if (settings.checkDuplicateDefinition) {
    diagnostics.push(...checkDuplicateDefinitionImpl(content));
  }
  if (settings.checkUnusedAcronym) {
    diagnostics.push(...checkUnusedAcronymImpl(content));
  }
  if (settings.checkConflictingDefinitions) {
    diagnostics.push(...checkConflictingDefinitionsImpl(content));
  }

  return diagnostics;
}
