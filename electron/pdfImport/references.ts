/**
 * Turns the frozen numbers in the text back into live references.
 *
 * A PDF contains `[7]` and `Figure 3` where the source had `\cite{jones99}` and
 * `Figure~\ref{fig:pipeline}`. Because the earlier stages recorded which numbers
 * belong to which float, section and reference entry, those strings can be rewired.
 * Rewrites never touch the inside of a formula or of an existing command argument,
 * and a number is only replaced when a matching label actually exists, so an
 * unresolved reference is left as plain text rather than becoming a broken build.
 */

import type { LabelMaps } from "./blocks.js";
import type { Reference } from "./bibliography.js";

export interface RewriteStats {
  citations: number;
  crossReferences: number;
  unresolvedCitations: number;
  /** True when the reference list is author-year rather than numeric. */
  authorYear: boolean;
}

/**
 * Applies `transform` to the prose parts of `latex`, leaving maths, verbatim and
 * the arguments of reference commands untouched.
 */
export function mapOutsideMath(
  latex: string,
  transform: (part: string) => string,
): string {
  const guarded =
    /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])*\$|\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|verbatim|lstlisting|tabular)\}[\s\S]*?\\end\{\1\}|\\(?:label|ref|eqref|cite[a-z]*|includegraphics|url|href)\s*(?:\[[^\]]*\])?\{[^}]*\}/g;

  let result = "";
  let cursor = 0;
  for (const match of latex.matchAll(guarded)) {
    const index = match.index ?? 0;
    result += transform(latex.slice(cursor, index));
    result += match[0];
    cursor = index + match[0].length;
  }
  result += transform(latex.slice(cursor));
  return result;
}

function expandNumberList(body: string): string[] | null {
  const parts = body.split(",").map((part) => part.trim());
  const numbers: string[] = [];
  for (const part of parts) {
    const range = /^(\d{1,3})\s*[-–—]{1,2}\s*(\d{1,3})$/.exec(part);
    if (range) {
      const from = Number.parseInt(range[1], 10);
      const to = Number.parseInt(range[2], 10);
      if (to < from || to - from > 40) {
        return null;
      }
      for (let value = from; value <= to; value += 1) {
        numbers.push(String(value));
      }
      continue;
    }
    if (!/^\d{1,3}[a-z]?$/.test(part)) {
      return null;
    }
    numbers.push(part);
  }
  return numbers.length ? numbers : null;
}

export function rewriteNumericCitations(
  latex: string,
  byMarker: Map<string, string>,
  stats: RewriteStats,
): string {
  if (!byMarker.size) {
    return latex;
  }
  return mapOutsideMath(latex, (part) =>
    // Consecutive bracket groups such as [1]--[3] are merged into one citation.
    part.replace(
      /\[([\d\s,–—-]{1,60})\](?:\s*[-–—]{1,2}\s*\[([\d\s,–—-]{1,60})\])?/g,
      (whole, first: string, second?: string) => {
        const firstNumbers = expandNumberList(first);
        if (!firstNumbers) {
          return whole;
        }
        let numbers = firstNumbers;
        if (second) {
          const secondNumbers = expandNumberList(second);
          if (!secondNumbers) {
            return whole;
          }
          const from = Number.parseInt(firstNumbers[firstNumbers.length - 1], 10);
          const to = Number.parseInt(secondNumbers[0], 10);
          if (
            Number.isFinite(from) &&
            Number.isFinite(to) &&
            to > from &&
            to - from <= 40
          ) {
            numbers = [...firstNumbers];
            for (let value = from + 1; value <= to; value += 1) {
              numbers.push(String(value));
            }
          } else {
            return whole;
          }
        }

        const keys = numbers.map((number) => byMarker.get(number));
        if (keys.some((key) => !key)) {
          stats.unresolvedCitations += 1;
          return whole;
        }
        stats.citations += 1;
        return `\\cite{${keys.join(",")}}`;
      },
    ),
  );
}

const etAlPattern = /\s+et\s+al\.?/i;

export function rewriteAuthorYearCitations(
  latex: string,
  references: Reference[],
  stats: RewriteStats,
): string {
  const bySurnameYear = new Map<string, string>();
  for (const reference of references) {
    if (!reference.year) {
      continue;
    }
    for (const surname of reference.authorSurnames) {
      bySurnameYear.set(`${surname.toLowerCase()}|${reference.year}`, reference.key);
    }
  }
  if (!bySurnameYear.size) {
    return latex;
  }

  const lookup = (names: string, year: string): string | null => {
    const cleaned = names
      .replace(etAlPattern, "")
      .replace(/\\emph\{|\}/g, "")
      .trim();
    for (const candidate of cleaned.split(/\s*(?:,|;|&|\band\b)\s*/i)) {
      const token = candidate.trim().split(/\s+/).pop();
      if (!token) {
        continue;
      }
      const key = bySurnameYear.get(`${token.toLowerCase()}|${year}`);
      if (key) {
        return key;
      }
    }
    return null;
  };

  return mapOutsideMath(latex, (part) => {
    // Parenthetical: (Smith et al., 2020; Doe, 2019)
    let result = part.replace(
      /\(([^()]{3,200}?(?:1[89]\d{2}|20\d{2})[a-z]?)\)/g,
      (whole, body: string) => {
        const groups = body.split(/\s*;\s*/);
        const keys: string[] = [];
        for (const group of groups) {
          const match = /^(.*?)[,\s]+\(?((?:1[89]\d{2}|20\d{2}))[a-z]?\)?$/.exec(
            group.trim(),
          );
          if (!match) {
            return whole;
          }
          const key = lookup(match[1], match[2]);
          if (!key) {
            return whole;
          }
          keys.push(key);
        }
        if (!keys.length) {
          return whole;
        }
        stats.citations += 1;
        return `\\citep{${keys.join(",")}}`;
      },
    );

    // Textual: Smith et al. (2020)
    result = result.replace(
      /\b([A-Z][A-Za-zÀ-ɏ'-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-zÀ-ɏ'-]+)?(?:\s+et\s+al\.?)?)\s+\((1[89]\d{2}|20\d{2})[a-z]?\)/g,
      (whole, names: string, year: string) => {
        const key = lookup(names, year);
        if (!key) {
          return whole;
        }
        stats.citations += 1;
        return `\\citet{${key}}`;
      },
    );

    return result;
  });
}

interface CrossReferenceRule {
  /** Words that introduce the reference, longest first. */
  words: string[];
  labels: Map<string, string>;
  command: "ref" | "eqref";
  parenthesised: boolean;
}

export function rewriteCrossReferences(
  latex: string,
  labels: LabelMaps,
  stats: RewriteStats,
): string {
  const rules: CrossReferenceRule[] = [
    {
      words: ["Figures", "Figure", "Figs\\.", "Fig\\.", "figures", "figure"],
      labels: labels.figures,
      command: "ref",
      parenthesised: false,
    },
    {
      words: ["Tables", "Table", "Tabs\\.", "Tab\\.", "tables", "table"],
      labels: labels.tables,
      command: "ref",
      parenthesised: false,
    },
    {
      words: ["Sections", "Section", "Secs\\.", "Sec\\.", "sections", "section", "\\S"],
      labels: labels.sections,
      command: "ref",
      parenthesised: false,
    },
    {
      words: ["Equations", "Equation", "Eqs\\.", "Eq\\.", "equations", "equation"],
      labels: labels.equations,
      command: "eqref",
      parenthesised: true,
    },
  ];

  let result = latex;
  for (const rule of rules) {
    if (!rule.labels.size) {
      continue;
    }
    const words = rule.words.join("|");
    const number = "\\d+(?:\\.\\d+)*[a-z]?";
    const pattern = new RegExp(
      `\\b(${words})(~|\\s{1,2})(\\(?)(${number})(\\)?)((?:\\s*(?:,|and|&|to|[-–—])\\s*\\(?${number}\\)?)*)`,
      "g",
    );

    result = mapOutsideMath(result, (part) =>
      part.replace(
        pattern,
        (
          whole,
          word: string,
          _space: string,
          open: string,
          first: string,
          close: string,
          rest: string,
        ) => {
          const numbers = [first, ...(rest.match(new RegExp(number, "g")) ?? [])];
          const keys = numbers.map((value) => rule.labels.get(value));
          if (!keys[0]) {
            return whole;
          }
          if (rule.parenthesised && (open === "(") !== (close === ")")) {
            return whole;
          }

          stats.crossReferences += 1;
          const rendered = numbers.map((value, index) => {
            const label = keys[index];
            if (!label) {
              return rule.parenthesised ? `(${value})` : value;
            }
            return `\\${rule.command}{${label}}`;
          });

          if (rendered.length === 1) {
            const body = rendered[0];
            return `${word}~${rule.parenthesised && !keys[0] ? body : body}`;
          }
          // Preserve the original joining words between the numbers.
          const separators = rest.match(/\s*(?:,|and|&|to|[-–—])\s*/g) ?? [];
          let joined = rendered[0];
          for (let index = 1; index < rendered.length; index += 1) {
            joined += `${separators[index - 1] ?? ", "}${rendered[index]}`;
          }
          return `${word}~${joined}`;
        },
      ),
    );
  }

  return result;
}

export function rewriteReferences(
  latex: string,
  labels: LabelMaps,
  references: Reference[],
): { latex: string; stats: RewriteStats } {
  const stats: RewriteStats = {
    citations: 0,
    crossReferences: 0,
    unresolvedCitations: 0,
    authorYear: false,
  };

  const byMarker = new Map<string, string>();
  for (const reference of references) {
    if (reference.marker) {
      byMarker.set(reference.marker, reference.key);
    }
  }

  let result = latex;
  if (byMarker.size) {
    result = rewriteNumericCitations(result, byMarker, stats);
  } else if (references.length) {
    stats.authorYear = true;
    result = rewriteAuthorYearCitations(result, references, stats);
  }
  result = rewriteCrossReferences(result, labels, stats);
  return { latex: result, stats };
}
