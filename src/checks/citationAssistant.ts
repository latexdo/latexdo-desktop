import type { Diagnostic, CitationAssistantSettings } from "../types";

function findLine(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function makeDiagnostic(
  line: number,
  message: string,
  detail: string,
  suggestion?: string,
): Diagnostic {
  return {
    file: "check",
    line,
    column: 1,
    severity: "warning",
    source: "citation-assistant" as Diagnostic["source"],
    message,
    detail,
    suggestion,
  };
}

function detectMissingCitationsImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const sectionOrParaBreak =
    /\n\s*\n|\\section\b|\\subsection\b|\\subsubsection\b|\\paragraph\b/;
  const paragraphs = content.split(sectionOrParaBreak);

  const claimWords =
    /\b(proposed|method|approach|technique|achieves|outperforms|state.of.the.art|state-of-the-art|accuracy|experimental|results|demonstrate|introduce|novel|efficient|robust|improves|enhances|framework|algorithm|system|model)\b/i;
  const citeRegex = /\\cite(?:[tp]?\*?)?\{[^}]*\}/g;

  let cursor = 0;
  for (const para of paragraphs) {
    const paraStartIndex = content.indexOf(para, cursor);
    cursor = paraStartIndex + para.length;
    const line = findLine(content, paraStartIndex);

    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%")) continue;

    const stripped = trimmed.replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?\{[^}]*\}/g, "");
    const hasClaim = claimWords.test(stripped);
    claimWords.lastIndex = 0;

    if (!hasClaim) continue;

    let citeCount = 0;
    citeRegex.lastIndex = 0;
    while (citeRegex.test(trimmed)) {
      citeCount++;
    }

    if (citeCount === 0) {
      diagnostics.push(
        makeDiagnostic(
          line,
          "Paragraph makes technical claims without supporting citations",
          `This paragraph contains language indicating a substantive claim (e.g., "${trimmed.match(claimWords)?.[0] || "technical term"}") but no \\cite{} command was found`,
          "Add one or more \\cite{...} references to support the claims made in this paragraph",
        ),
      );
    }
  }

  return diagnostics;
}

function detectUnusedEntriesImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const nociteStar = /\\nocite\s*\{\*\}/;
  if (nociteStar.test(content)) {
    return diagnostics;
  }

  const bibitemRegex = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  const bibitemKeys: { key: string; line: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = bibitemRegex.exec(content)) !== null) {
    bibitemKeys.push({
      key: match[1].trim(),
      line: findLine(content, match.index),
    });
  }

  if (bibitemKeys.length === 0) {
    const thebibliography = /\\begin\s*\{thebibliography\}/;
    if (!thebibliography.test(content)) {
      diagnostics.push(
        makeDiagnostic(
          1,
          "No bibliography found in document",
          "The document does not contain \\thebibliography, \\bibliography, or \\addbibresource",
          "Add a bibliography using \\bibliography{refs} or \\begin{thebibliography}...\\end{thebibliography}",
        ),
      );
    }
    return diagnostics;
  }

  const usedCiteKeys = new Set<string>();
  const citeRegex = /\\cite(?:[tp]?\*?)?\{([^}]+)\}/g;
  while ((match = citeRegex.exec(content)) !== null) {
    const keys = match[1].split(",").map((k) => k.trim());
    for (const key of keys) {
      usedCiteKeys.add(key);
    }
  }

  for (const entry of bibitemKeys) {
    if (!usedCiteKeys.has(entry.key)) {
      diagnostics.push(
        makeDiagnostic(
          entry.line,
          `Unused bibliography entry: "${entry.key}"`,
          `The \\bibitem{${entry.key}} entry is defined but never cited with \\cite{} in the text`,
          `Either add \\cite{${entry.key}} where relevant or remove the \\bibitem entry`,
        ),
      );
    }
  }

  return diagnostics;
}

function detectDuplicateReferencesImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const citeRegex = /\\cite(?:[tp]?\*?)?\{([^}]+)\}/g;
  const allCitedKeys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = citeRegex.exec(content)) !== null) {
    const keys = match[1]
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    allCitedKeys.push(...keys);
  }

  const citedKeyCounts = new Map<string, number>();
  for (const key of allCitedKeys) {
    citedKeyCounts.set(key, (citedKeyCounts.get(key) || 0) + 1);
  }

  const bibitemRegex = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  const bibitemEntries: { key: string; index: number }[] = [];
  while ((match = bibitemRegex.exec(content)) !== null) {
    bibitemEntries.push({ key: match[1].trim(), index: match.index });
  }

  const seenBibitem = new Map<string, number>();
  for (let i = 0; i < bibitemEntries.length; i++) {
    const { key, index } = bibitemEntries[i];
    if (seenBibitem.has(key)) {
      const line = findLine(content, index);
      diagnostics.push(
        makeDiagnostic(
          line,
          `Duplicate \\bibitem definition: "${key}" appears multiple times`,
          `The bibliography key "${key}" is defined more than once in \\thebibliography; LaTeX will only use the first definition`,
          `Remove the duplicate \\bibitem{${key}} entry and merge the references`,
        ),
      );
    } else {
      seenBibitem.set(key, i);
    }
  }

  const citeKeySet = new Set(allCitedKeys);
  const similarPairs: Array<[string, string]> = [];
  const keysArray = Array.from(citeKeySet);
  for (let i = 0; i < keysArray.length; i++) {
    for (let j = i + 1; j < keysArray.length; j++) {
      const a = keysArray[i].toLowerCase();
      const b = keysArray[j].toLowerCase();
      if (a === b) continue;

      if (levenshteinDistance(a, b) <= 3 && a.length > 4 && b.length > 4) {
        similarPairs.push([keysArray[i], keysArray[j]]);
      }
    }
  }

  for (const [keyA, keyB] of similarPairs) {
    const citeLine = findLine(content, content.indexOf(`\\cite`));
    diagnostics.push(
      makeDiagnostic(
        citeLine,
        `Potentially duplicate references: "${keyA}" and "${keyB}" may refer to the same work`,
        `Citation keys "${keyA}" and "${keyB}" are very similar (Levenshtein distance <= 3); they might reference the same paper with inconsistent keys`,
        `Consider merging "${keyA}" and "${keyB}" into a single consistent key`,
      ),
    );
  }

  return diagnostics;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function detectBrokenLinksImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const hrefRegex = /\\href\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(content)) !== null) {
    const url = match[1].trim();
    const line = findLine(content, match.index);

    if (!/^https?:\/\//.test(url) && !/^ftp:\/\//.test(url) && !/^mailto:/.test(url)) {
      diagnostics.push(
        makeDiagnostic(
          line,
          `URL in \\href missing scheme: "${url}"`,
          `The URL "${url}" does not start with http://, https://, ftp://, or mailto:`,
          `Add a scheme prefix: \\href{https://${url}}{...}`,
        ),
      );
    }

    if (/\s/.test(url)) {
      diagnostics.push(
        makeDiagnostic(
          line,
          `URL in \\href contains spaces: "${url}"`,
          "URLs should not contain unencoded whitespace characters",
          `Replace spaces with %20 or remove them: \\href{${url.replace(/\s+/g, "%20")}}{...}`,
        ),
      );
    }

    if (url.includes("doi.org/10.")) {
      const doiPart = url.match(/doi\.org\/(10\.\d{4,}\/[^\s,;}]+)/);
      if (doiPart) {
        const doi = doiPart[1];
        const doiValidation = /^10\.\d{4,}\/[^\s]+$/;
        if (!doiValidation.test(doi)) {
          diagnostics.push(
            makeDiagnostic(
              line,
              `Malformed DOI in URL: "${doi}"`,
              `The DOI "${doi}" does not follow the standard pattern 10.NNNN/...`,
              `Verify the DOI string is correct: https://doi.org/${doi}`,
            ),
          );
        }
      }
    }
  }

  const urlRegex = /\\url\s*\{([^}]+)\}/g;
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[1].trim();
    const line = findLine(content, match.index);

    if (
      !/^https?:\/\//.test(url) &&
      !/^ftp:\/\//.test(url) &&
      !url.startsWith("www.")
    ) {
      diagnostics.push(
        makeDiagnostic(
          line,
          `URL in \\url may be missing scheme: "${url}"`,
          `The URL "${url}" does not start with a protocol or www.`,
          `Consider: \\url{https://${url}}`,
        ),
      );
    }

    if (/\s/.test(url)) {
      diagnostics.push(
        makeDiagnostic(
          line,
          `URL in \\url contains spaces: "${url}"`,
          "URLs should not contain whitespace characters",
          `Use \\url{${url.replace(/\s+/g, "")}} or encode spaces as %20`,
        ),
      );
    }
  }

  const doiCmdRegex = /\\doi\s*\{([^}]+)\}/g;
  while ((match = doiCmdRegex.exec(content)) !== null) {
    const doi = match[1].trim();
    const line = findLine(content, match.index);

    const doiPattern = /^10\.\d{4,}\/[^\s]+$/;
    if (!doiPattern.test(doi)) {
      diagnostics.push(
        makeDiagnostic(
          line,
          `Malformed \\doi command: "${doi}"`,
          `The DOI "${doi}" does not match the standard pattern (e.g., 10.1234/abcd)`,
          `Correct the DOI or use a full URL: \\href{https://doi.org/${doi}}{link}`,
        ),
      );
    }
  }

  const doiInlineRegex = /(?:^|[^\\])(10\.\d{4,}\/[^\s,;.}+\)]+)/g;
  while ((match = doiInlineRegex.exec(content)) !== null) {
    const doi = match[1];
    if (!content.includes(`\\doi{${doi}}`) && !content.includes(`doi.org/${doi}`)) {
      const line = findLine(content, match.index + 1);
      diagnostics.push(
        makeDiagnostic(
          line,
          `Bare DOI found in text: "${doi}"`,
          `The DOI "${doi}" appears as plain text rather than inside \\doi{} or \\href{}`,
          `Wrap it: \\doi{${doi}} or \\href{https://doi.org/${doi}}{link}`,
        ),
      );
    }
  }

  return diagnostics;
}

function suggestCitationKeysImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const sentenceSplit = /(?<=[.!?])\s+/;
  const sentences = content.split(sentenceSplit);

  const relatedWorkSection = /\\section\s*\{[^}]*[Rr]elated\s+[Ww]ork[^}]*\}/;
  const inRelatedWork = relatedWorkSection.test(content);

  const citeRegex = /\\cite(?:[tp]?\*?)?\{[^}]*\}/g;
  const claimPatterns = [
    /\bas\s+shown\s+in\b/i,
    /\bdemonstrated\s+that\b/i,
    /\bachieved?\b/i,
    /\bproposed\s+by\b/i,
    /\bintroduced\b/i,
    /\breported\b/i,
    /\baccording\s+to\b/i,
    /\bprevious\s+work\b/i,
    /\bprior\s+work\b/i,
    /\brecent\s+(stud|work|research|paper)s?\b/i,
    /\bit\s+(has\s+been|was)\s+(shown|demonstrated|reported|found|observed|established)\b/i,
    /\bstudies?\s+(have|has)\s+(shown|demonstrated|reported|found|indicated)\b/i,
    /\bextensive\s+(research|studies|work|literature)\b/i,
    /\bnumerous\s+(studies|works|papers|reports)\b/i,
    /\bexperimental\s+(results|evidence|data|findings)\b/i,
  ];

  let sentenceStartIndex = 0;
  for (const sentence of sentences) {
    const line = findLine(content, sentenceStartIndex);
    sentenceStartIndex += sentence.length + 1;

    const trimmed = sentence.trim();
    if (!trimmed || trimmed.length < 20) continue;
    if (trimmed.startsWith("%")) continue;

    if (inRelatedWork) continue;

    citeRegex.lastIndex = 0;
    if (citeRegex.test(trimmed)) continue;

    const stripped = trimmed.replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?\{[^}]*\}/g, "");
    let matchedPattern = false;
    let matchedText = "";
    for (const pattern of claimPatterns) {
      pattern.lastIndex = 0;
      const pm = pattern.exec(stripped);
      if (pm) {
        matchedPattern = true;
        matchedText = pm[0];
        break;
      }
    }

    if (matchedPattern) {
      diagnostics.push(
        makeDiagnostic(
          line,
          `Sentence may need a citation (contains "${matchedText}")`,
          `This sentence uses language ("${matchedText}") that typically requires a supporting citation`,
          `Add \\cite{ref} to cite the relevant work for this claim`,
        ),
      );
    }
  }

  return diagnostics;
}

function warnOldCitationsImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const yearRegex = /\(?(19\d{2}|20\d{2})\)?/g;
  const bibitemRegex =
    /\\bibitem\s*(?:\[[^\]]*\])?\s*\{[^}]+\}\s*([^]*?)(?=\\bibitem|\n\s*\\end\{thebibliography\}|$)/gi;

  const years: { year: number; line: number; key?: string }[] = [];
  let match: RegExpExecArray | null;

  const inlineYearRegex =
    /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}\s*([^]*?)(?=\\bibitem|\\end\{thebibliography\}|$)/g;
  while ((match = inlineYearRegex.exec(content)) !== null) {
    const key = match[1].trim();
    const entryText = match[2];
    const line = findLine(content, match.index);

    yearRegex.lastIndex = 0;
    const yearMatch = yearRegex.exec(entryText);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      years.push({ year, line, key });
    }
  }

  for (const entry of years) {
    if (entry.year < 2020 && entry.year >= 1900) {
      diagnostics.push(
        makeDiagnostic(
          entry.line,
          `Old citation (${entry.year}): "${entry.key || "unknown"}" predates 2020`,
          `Reference "${entry.key || "unknown"}" is from ${entry.year}; a more recent survey or updated results may exist`,
          `Check if there is a newer version or survey that supersedes this ${entry.year} reference`,
        ),
      );
    }
  }

  if (years.length > 0) {
    const allOld = years.every((y) => y.year < new Date().getFullYear() - 5);
    if (allOld) {
      const lastYear = Math.max(...years.map((y) => y.year));
      diagnostics.push(
        makeDiagnostic(
          1,
          `All citations are from ${lastYear} or earlier; consider checking for recent work`,
          "All bibliographic references are more than 5 years old, which may indicate the paper has not incorporated recent developments",
          "Search for surveys or recent papers published after " +
            (lastYear + 1) +
            " to ensure the literature review is current",
        ),
      );
    }
  }

  return diagnostics;
}

export function runCitationChecks(
  content: string,
  settings: CitationAssistantSettings,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!settings.enabled || !content) {
    return diagnostics;
  }

  if (settings.detectMissingCitations) {
    diagnostics.push(...detectMissingCitationsImpl(content));
  }

  if (settings.detectUnusedEntries) {
    diagnostics.push(...detectUnusedEntriesImpl(content));
  }

  if (settings.detectDuplicateReferences) {
    diagnostics.push(...detectDuplicateReferencesImpl(content));
  }

  if (settings.detectBrokenLinks) {
    diagnostics.push(...detectBrokenLinksImpl(content));
  }

  if (settings.suggestCitationKeys) {
    diagnostics.push(...suggestCitationKeysImpl(content));
  }

  if (settings.warnOldCitations) {
    diagnostics.push(...warnOldCitationsImpl(content));
  }

  return diagnostics;
}
