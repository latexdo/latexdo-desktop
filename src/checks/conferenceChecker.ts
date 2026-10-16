import type {
  Diagnostic,
  ConferenceCheckerSettings,
  ConferenceTemplate,
} from "../types";

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
  suggestion: string,
): Diagnostic {
  return {
    file: "check",
    line,
    column: 1,
    severity: "warning",
    source: "conference-checker" as Diagnostic["source"],
    message,
    detail,
    suggestion,
  };
}

function checkMarginsImpl(content: string, template: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const ieeePattern = /\\documentclass\s*\[([^\]]*)\]\s*\{IEEEtran\}/i;
  const acmPattern = /\\documentclass\s*\[([^\]]*)\]\s*\{acmart\}/i;
  const springerPattern1 = /\\documentclass\s*\[([^\]]*)\]\s*\{sn-jnl\}/i;
  const springerPattern2 = /\\documentclass\s*\{svjour3\}/i;
  const elsevierPattern = /\\documentclass\s*\[?([^\]]*)\]?\s*\{elsarticle\}/i;
  const neuripsPattern = /\\documentclass\s*\{neurips_2024\}/i;
  const cvprPattern = /\\documentclass\s*\[?([^\]]*)\]?\s*\{cvpr\}/i;

  const ieeeMatch = content.match(ieeePattern);
  const acmMatch = content.match(acmPattern);
  const springerMatch =
    content.match(springerPattern1) || content.match(springerPattern2);
  const elsevierMatch = content.match(elsevierPattern);
  const neuripsMatch = content.match(neuripsPattern);
  const cvprMatch = content.match(cvprPattern);

  let foundTemplate = template;
  if (ieeeMatch) foundTemplate = "ieee";
  else if (acmMatch) foundTemplate = "acm";
  else if (springerMatch) foundTemplate = "springer";
  else if (elsevierMatch) foundTemplate = "elsevier";
  else if (neuripsMatch) foundTemplate = "neurips";
  else if (cvprMatch) foundTemplate = "cvpr";

  if (ieeeMatch) {
    const opts = ieeeMatch[1];
    if (!opts.includes("conference") && !opts.includes("journal")) {
      const line = findLine(content, ieeeMatch.index!);
      diagnostics.push(
        makeDiagnostic(
          line,
          "IEEE document class missing [conference] option",
          "IEEEtran should include [conference] for conference submissions or [journal] for journal submissions",
          "Use \\documentclass[conference]{IEEEtran} for conference papers",
        ),
      );
    }
  }
  if (acmMatch) {
    const opts = acmMatch[1];
    if (!opts.includes("sigconf")) {
      const line = findLine(content, acmMatch.index!);
      diagnostics.push(
        makeDiagnostic(
          line,
          "ACM document class missing [sigconf] option",
          "acmart should include [sigconf] for conference submissions",
          "Use \\documentclass[sigconf]{acmart}",
        ),
      );
    }
  }
  if (springerMatch && springerMatch.index !== undefined) {
    const m = content.match(springerPattern1);
    if (m) {
      const opts = m[1];
      if (!opts.includes("sn-mathphys-num") && !opts.includes("sn-mathphys")) {
        const line = findLine(content, m.index!);
        diagnostics.push(
          makeDiagnostic(
            line,
            "Springer document class may need [sn-mathphys-num] option",
            "sn-jnl typically uses [sn-mathphys-num] for mathematics and physics submissions",
            "Use \\documentclass[sn-mathphys-num]{sn-jnl}",
          ),
        );
      }
    }
  }

  const geometryPattern = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{geometry\}/;
  const geometryMatch = content.match(geometryPattern);
  if (geometryMatch) {
    const options = geometryMatch[1] || "";
    if (
      options.includes("margin") ||
      options.includes("left=") ||
      options.includes("right=") ||
      options.includes("top=") ||
      options.includes("bottom=")
    ) {
      switch (foundTemplate) {
        case "ieee":
        case "acm":
        case "springer":
        case "elsevier":
        case "neurips":
        case "cvpr": {
          const line = findLine(content, geometryMatch.index!);
          diagnostics.push(
            makeDiagnostic(
              line,
              "Custom geometry margins override template defaults",
              `${foundTemplate.toUpperCase()} template has specific margin requirements; overriding with geometry may violate formatting guidelines`,
              "Remove or comment out custom geometry margin settings for conference submission",
            ),
          );
          break;
        }
        default:
          break;
      }
    }
  }

  const hoffsetPattern = /\\setlength\s*\{\\hoffset\}\s*\{([^}]+)\}/g;
  let hoffsetMatch: RegExpExecArray | null;
  while ((hoffsetMatch = hoffsetPattern.exec(content)) !== null) {
    const line = findLine(content, hoffsetMatch.index);
    diagnostics.push(
      makeDiagnostic(
        line,
        "Custom \\hoffset override detected",
        `Setting \\hoffset to ${hoffsetMatch[1]} may violate template margin requirements`,
        "Remove \\setlength{\\hoffset} or ensure it matches template specifications",
      ),
    );
  }

  const marginCmds = [
    { pattern: /\\oddsidemargin\s+(-?\d+)/g, name: "\\oddsidemargin" },
    { pattern: /\\evensidemargin\s+(-?\d+)/g, name: "\\evensidemargin" },
    { pattern: /\\topmargin\s+(-?\d+)/g, name: "\\topmargin" },
  ];
  for (const cmd of marginCmds) {
    let marginMatch: RegExpExecArray | null;
    while ((marginMatch = cmd.pattern.exec(content)) !== null) {
      const line = findLine(content, marginMatch.index);
      diagnostics.push(
        makeDiagnostic(
          line,
          `Manual ${cmd.name} override detected`,
          `Setting ${cmd.name} to ${marginMatch[1]} may conflict with template's default margins`,
          `Remove the ${cmd.name} override and rely on the document class's default margins`,
        ),
      );
    }
  }

  return diagnostics;
}

function checkFontSizeImpl(content: string, template: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const docclassPattern = /\\documentclass\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = docclassPattern.exec(content)) !== null) {
    const opts = match[1];
    const fontSizeMatch = opts.match(/\b(10pt|11pt|12pt)\b/);
    if (fontSizeMatch) {
      const found = fontSizeMatch[1];
      switch (template) {
        case "ieee":
          if (found !== "10pt") {
            const line = findLine(content, match.index);
            diagnostics.push(
              makeDiagnostic(
                line,
                `Font size ${found} may not comply with IEEE requirements`,
                "IEEE conference papers typically require 10pt font size",
                `Change ${found} to 10pt in \\documentclass options`,
              ),
            );
          }
          break;
        case "acm":
          if (found !== "10pt") {
            const line = findLine(content, match.index);
            diagnostics.push(
              makeDiagnostic(
                line,
                `Font size ${found} may not comply with ACM requirements`,
                "ACM conference papers typically use 10pt font size",
                `Change ${found} to 10pt in \\documentclass options`,
              ),
            );
          }
          break;
        case "springer":
          if (found !== "12pt") {
            const line = findLine(content, match.index);
            diagnostics.push(
              makeDiagnostic(
                line,
                `Font size ${found} may not comply with Springer requirements`,
                "Springer journals typically require 12pt font size",
                `Change ${found} to 12pt in \\documentclass options`,
              ),
            );
          }
          break;
        default:
          break;
      }
    } else {
      switch (template) {
        case "ieee": {
          const line = findLine(content, match.index);
          diagnostics.push(
            makeDiagnostic(
              line,
              "No explicit font size specified; IEEE requires 10pt",
              "IEEE conference papers require 10pt as the base font size",
              "Add 10pt to \\documentclass options, e.g. \\documentclass[conference,10pt]{IEEEtran}",
            ),
          );
          break;
        }
        case "acm": {
          const line = findLine(content, match.index);
          diagnostics.push(
            makeDiagnostic(
              line,
              "No explicit font size specified; ACM typically uses 10pt",
              "ACM conference papers typically use 10pt font size",
              "Add 10pt to \\documentclass options",
            ),
          );
          break;
        }
        default:
          break;
      }
    }
  }

  const fontsizePattern = /\\fontsize\s*\{([^}]+)\}\s*\{([^}]+)\}/g;
  let fsMatch: RegExpExecArray | null;
  while ((fsMatch = fontsizePattern.exec(content)) !== null) {
    const size = fsMatch[1];
    if (size !== "10pt" && size !== "11pt" && size !== "12pt") {
      const line = findLine(content, fsMatch.index);
      diagnostics.push(
        makeDiagnostic(
          line,
          `Non-standard font size (${size}) override via \\fontsize`,
          "Explicit \\fontsize commands that deviate from the template's base font size may violate formatting guidelines",
          "Remove or adjust the \\fontsize command to match the required document font size",
        ),
      );
    }
  }

  return diagnostics;
}

function checkAbstractLengthImpl(content: string, template: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const envMatch = content.match(
    /\\begin\s*\{abstract\}\s*([\s\S]*?)\\end\s*\{abstract\}/,
  );
  const cmdMatch = content.match(/\\abstract\s*\{([^}]+)\}/);

  let abstractText = "";
  let abstractLine = 1;

  if (envMatch) {
    abstractText = envMatch[1].replace(/\\(?:no)?\w+/g, "").replace(/[{}]/g, "");
    abstractLine = findLine(content, envMatch.index!);
  } else if (cmdMatch) {
    abstractText = cmdMatch[1].replace(/\\(?:no)?\w+/g, "").replace(/[{}]/g, "");
    abstractLine = findLine(content, cmdMatch.index!);
  }

  if (!envMatch && !cmdMatch) {
    diagnostics.push(
      makeDiagnostic(
        1,
        "No abstract found",
        "The document does not contain an abstract environment; most conferences require an abstract",
        "Add \\begin{abstract}...\\end{abstract} to your document",
      ),
    );
    return diagnostics;
  }

  const wordCount = countWords(abstractText);

  let maxWords = 250;
  switch (template) {
    case "ieee":
      maxWords = 250;
      break;
    case "acm":
      maxWords = 150;
      break;
    case "springer":
      maxWords = 250;
      break;
    case "neurips":
      maxWords = 200;
      break;
    case "cvpr":
      maxWords = 250;
      break;
    default:
      maxWords = 250;
  }

  if (wordCount > maxWords) {
    diagnostics.push(
      makeDiagnostic(
        abstractLine,
        `Abstract exceeds ${template.toUpperCase()} word limit (${wordCount} > ${maxWords} words)`,
        `${template.toUpperCase()} typically requires the abstract to be at most ${maxWords} words; current abstract has ${wordCount} words`,
        `Shorten the abstract to ${maxWords} words or fewer (currently ${wordCount - maxWords} over)`,
      ),
    );
  }

  if (wordCount < 50) {
    diagnostics.push(
      makeDiagnostic(
        abstractLine,
        "Abstract is very short (less than 50 words)",
        `Current abstract has only ${wordCount} words; most conferences expect a substantive abstract`,
        "Expand the abstract to provide an adequate summary of the paper",
      ),
    );
  }

  return diagnostics;
}

function checkKeywordsImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const keywordPatterns = [/\\keywords\s*\{/, /\\KW\s*\{/];
  let found = false;
  for (const p of keywordPatterns) {
    if (p.test(content)) {
      found = true;
      break;
    }
  }

  if (!found) {
    if (content.includes("\\begin{abstract}") || content.includes("\\documentclass")) {
      diagnostics.push(
        makeDiagnostic(
          1,
          "Keywords section missing",
          "Most conferences require a \\keywords{} or \\KW{} command to list paper keywords",
          "Add \\keywords{keyword1, keyword2, ...} after the abstract",
        ),
      );
    }
  }

  return diagnostics;
}

function checkFigureReferencesImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const figurePattern = /\\begin\s*\{figure\}(?:\s*\[[^\]]*\])?\s*/g;
  const figureLabels: { label: string; line: number }[] = [];
  let figMatch: RegExpExecArray | null;
  while ((figMatch = figurePattern.exec(content)) !== null) {
    const remainder = content.slice(figMatch.index);
    const labelMatch = remainder.match(/\\label\s*\{([^}]+)\}/);
    if (labelMatch) {
      figureLabels.push({
        label: labelMatch[1],
        line: findLine(content, figMatch.index),
      });
    } else {
      figureLabels.push({
        label: "unnamed",
        line: findLine(content, figMatch.index),
      });
    }
  }

  const includegraphicsPattern = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  const graphicFiles: { file: string; line: number }[] = [];
  let gMatch: RegExpExecArray | null;
  while ((gMatch = includegraphicsPattern.exec(content)) !== null) {
    graphicFiles.push({
      file: gMatch[1],
      line: findLine(content, gMatch.index),
    });
  }

  const refPattern = /(?:\\ref\s*\{fig:|Fig\.~\\ref\{|Figure~\\ref\{)([^}]+)\}/g;
  const referencedFigures = new Set<string>();
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refPattern.exec(content)) !== null) {
    const labelName = refMatch[1].replace(/\\ref\{fig:/g, "").replace(/fig:/, "");
    referencedFigures.add(labelName);
  }

  const figRefAny = /\\ref\{([^}]+)\}/g;
  while ((refMatch = figRefAny.exec(content)) !== null) {
    const label = refMatch[1];
    if (label.startsWith("fig:")) {
      referencedFigures.add(label);
    }
  }

  for (const fig of figureLabels) {
    if (fig.label !== "unnamed" && !referencedFigures.has(fig.label)) {
      diagnostics.push(
        makeDiagnostic(
          fig.line,
          `Figure "${fig.label}" is not referenced in the text`,
          "All figures should be cited in the text using \\ref{}; this figure may be orphaned",
          `Add a reference like \\ref{${fig.label}} or Figure~\\ref{${fig.label}} in the text`,
        ),
      );
    }
  }

  if (graphicFiles.length > 0 && figureLabels.length === 0) {
    for (const gf of graphicFiles) {
      diagnostics.push(
        makeDiagnostic(
          gf.line,
          `\\includegraphics{${gf.file}} used outside a figure environment`,
          "Images should typically be placed inside a \\begin{figure}...\\end{figure} environment",
          `Wrap the includegraphics in a figure environment with \\caption and \\label`,
        ),
      );
    }
  }

  return diagnostics;
}

function checkTableReferencesImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const tablePattern = /\\begin\s*\{table\}(?:\s*\[[^\]]*\])?\s*/g;
  const tableLabels: { label: string; line: number }[] = [];
  let tabMatch: RegExpExecArray | null;
  while ((tabMatch = tablePattern.exec(content)) !== null) {
    const remainder = content.slice(tabMatch.index);
    const labelMatch = remainder.match(/\\label\s*\{([^}]+)\}/);
    if (labelMatch) {
      tableLabels.push({
        label: labelMatch[1],
        line: findLine(content, tabMatch.index),
      });
    } else {
      tableLabels.push({
        label: "unnamed",
        line: findLine(content, tabMatch.index),
      });
    }
  }

  const tabularPattern = /\\begin\s*\{tabular\}/g;
  let tabularCount = 0;
  while (tabularPattern.exec(content) !== null) {
    tabularCount++;
  }

  const refPattern = /(?:\\ref\s*\{tab:|Table~\\ref\{|Tab\.~\\ref\{)([^}]+)\}/g;
  const referencedTables = new Set<string>();
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refPattern.exec(content)) !== null) {
    referencedTables.add(refMatch[1]);
  }

  const tabRefAny = /\\ref\{([^}]+)\}/g;
  while ((refMatch = tabRefAny.exec(content)) !== null) {
    const label = refMatch[1];
    if (label.startsWith("tab:")) {
      referencedTables.add(label);
    }
  }

  for (const tbl of tableLabels) {
    if (tbl.label !== "unnamed" && !referencedTables.has(tbl.label)) {
      diagnostics.push(
        makeDiagnostic(
          tbl.line,
          `Table "${tbl.label}" is not referenced in the text`,
          "All tables should be cited in the text using \\ref{}; this table may be orphaned",
          `Add a reference like \\ref{${tbl.label}} or Table~\\ref{${tbl.label}} in the text`,
        ),
      );
    }
  }

  if (tabularCount > 0 && tableLabels.length === 0) {
    diagnostics.push(
      makeDiagnostic(
        1,
        `Found ${tabularCount} tabular environment(s) but no table environments with labels`,
        "Tables should be wrapped in \\begin{table}...\\end{table} with \\caption and \\label",
        "Wrap each tabular in a table environment and add a \\label{tab:...}",
      ),
    );
  }

  return diagnostics;
}

function checkBibliographyStyleImpl(content: string, template: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const stylePattern = /\\bibliographystyle\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  const foundStyles: { style: string; line: number }[] = [];
  while ((match = stylePattern.exec(content)) !== null) {
    foundStyles.push({
      style: match[1].toLowerCase(),
      line: findLine(content, match.index),
    });
  }

  // sn-jnl picks the style from a class option; biblatex sets it on load.
  const styleSetElsewhere =
    /\\documentclass\s*(?:\[[^\]]*\])?\s*\{(?:sn-jnl|acmart)\}/.test(content) ||
    /\\usepackage\s*(?:\[[^\]]*\])?\s*\{biblatex\}|\\addbibresource/.test(content);
  if (foundStyles.length === 0) {
    if (template !== "custom" && !styleSetElsewhere) {
      diagnostics.push(
        makeDiagnostic(
          1,
          "No \\bibliographystyle{} found",
          `${template.toUpperCase()} template typically requires a specific bibliography style`,
          `Add \\bibliographystyle{${getRecommendedStyle(template)}} before \\bibliography{}`,
        ),
      );
    }
    return diagnostics;
  }

  for (const fs of foundStyles) {
    const recommended = getRecommendedStyle(template);
    const acceptable = getAcceptableStyles(template);
    if (!acceptable.includes(fs.style)) {
      diagnostics.push(
        makeDiagnostic(
          fs.line,
          `Bibliography style "${fs.style}" may not match ${template.toUpperCase()} template requirements`,
          `${template.toUpperCase()} typically expects "${recommended}" style (acceptable: ${acceptable.join(", ")})`,
          `Change to \\bibliographystyle{${recommended}}`,
        ),
      );
    }
  }

  return diagnostics;
}

function getRecommendedStyle(template: string): string {
  switch (template) {
    case "ieee":
      return "IEEEtran";
    case "acm":
      return "acm";
    case "springer":
      return "spmpsi";
    case "elsevier":
      return "elsarticle-num";
    case "neurips":
      return "plain";
    case "cvpr":
      return "plain";
    default:
      return "plain";
  }
}

function getAcceptableStyles(template: string): string[] {
  switch (template) {
    case "ieee":
      return ["ieeetr", "ieeetran"];
    case "acm":
      return ["acm", "plain", "abbrv"];
    case "springer":
      return ["spmpsi", "plain"];
    case "elsevier":
      return ["elsarticle-num", "model1-num-names"];
    case "neurips":
      return ["plain", "abbrv", "unsrt"];
    case "cvpr":
      return ["plain", "abbrv"];
    default:
      return ["plain", "ieeetr", "acm", "spmpsi", "elsarticle-num", "abbrv", "unsrt"];
  }
}

function checkPageLimitImpl(content: string, template: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const totalChars = content.length;

  const newpageCount = (content.match(/\\newpage/g) || []).length;
  const clearpageCount = (content.match(/\\clearpage/g) || []).length;
  const pageBreakCount = newpageCount + clearpageCount;

  const estimatedCharsPerPage = 3000;
  let estimatedPages = Math.max(
    Math.ceil(totalChars / estimatedCharsPerPage),
    pageBreakCount + 1,
  );

  const pageLimitMap: Record<string, number> = {
    ieee: 6,
    acm: 10,
    springer: 25,
    elsevier: 25,
    neurips: 8,
    cvpr: 8,
  };

  const limit = pageLimitMap[template] || 10;

  if (estimatedPages > limit) {
    diagnostics.push(
      makeDiagnostic(
        1,
        `Estimated page count (${estimatedPages}) may exceed ${template.toUpperCase()} page limit (${limit})`,
        `Based on ~${estimatedCharsPerPage} characters per page, the document is approximately ${estimatedPages} pages; ${template.toUpperCase()} limits papers to ${limit} pages`,
        `Consider condensing content to fit within ${limit} pages (remove approximately ${(estimatedPages - limit) * estimatedCharsPerPage} characters)`,
      ),
    );
  }

  return diagnostics;
}

function checkAuthorInfoImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Matches \author{...}, \author*{...} and \author[1]{...}. Classes like
  // sn-jnl put \email and \affil next to the braces, so the block runs to the
  // next \author (or a short window) and affiliations count document-wide.
  const authorPattern = /\\author\*?\s*(?:\[[^\]]*\])?\s*\{/g;
  const hasAffiliation = /\\(?:affil|affiliation|institute|address)\b/.test(content);
  let match: RegExpExecArray | null;
  let authorFound = false;
  while ((match = authorPattern.exec(content)) !== null) {
    authorFound = true;
    const rest = content.slice(match.index + match[0].length);
    const nextAuthor = rest.search(/\\author\b|\\maketitle|\\begin\{abstract\}/);
    const authorBlock = rest.slice(
      0,
      nextAuthor >= 0 ? Math.min(nextAuthor, 600) : 600,
    );
    const line = findLine(content, match.index);

    if (
      !authorBlock.includes("\\email") &&
      !authorBlock.includes("\\texttt") &&
      !authorBlock.includes("@")
    ) {
      diagnostics.push(
        makeDiagnostic(
          line,
          "Author block missing email address",
          "Conference papers typically require author email addresses for correspondence",
          "Add \\email{...} or an email address in the \\author{} block",
        ),
      );
    }

    if (
      !hasAffiliation &&
      !authorBlock.includes("\\affiliation") &&
      !authorBlock.includes("\\institute") &&
      !authorBlock.includes("\\address")
    ) {
      diagnostics.push(
        makeDiagnostic(
          line,
          "Author block missing affiliation/institution",
          "Most conferences require author affiliations to be listed with each author",
          "Add \\affiliation{...} or \\institute{...} for each author",
        ),
      );
    }

    const andCount = (authorBlock.match(/\\and/g) || []).length;
    const authorCount = andCount + 1;
    if (authorCount > 10) {
      diagnostics.push(
        makeDiagnostic(
          line,
          `Large number of authors (${authorCount}) detected`,
          "Some conferences have strict limits on the number of authors; verify that this many authors is permitted",
          "Check the conference's author guidelines for maximum author count",
        ),
      );
    }
  }

  if (!authorFound) {
    if (content.includes("\\documentclass") || content.includes("\\title")) {
      diagnostics.push(
        makeDiagnostic(
          1,
          "No \\author{} command found",
          "Conference papers must declare authors using the \\author{} command",
          "Add \\author{Author Name \\affiliation{...} \\email{...}} to the preamble",
        ),
      );
    }
  }

  return diagnostics;
}

function checkAnonymousReviewImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const thanksPattern = /\\thanks\s*\{([^}]*)\}/g;
  let thanksMatch: RegExpExecArray | null;
  while ((thanksMatch = thanksPattern.exec(content)) !== null) {
    const thanksText = thanksMatch[1].toLowerCase();
    const line = findLine(content, thanksMatch.index);

    if (
      thanksText.includes("@") ||
      thanksText.includes("email") ||
      thanksText.includes("e-mail")
    ) {
      diagnostics.push(
        makeDiagnostic(
          line,
          "\\thanks{} may contain author-identifying information (email)",
          "For double-blind review, \\thanks should not reveal author identity",
          "Remove or anonymize the \\thanks{} content for blind review submission",
        ),
      );
    }

    const nameIndicators = [
      "ph.d",
      "prof",
      "dr.",
      "department of",
      "university of",
      "institute of",
      "laboratory",
    ];
    for (const indicator of nameIndicators) {
      if (thanksText.includes(indicator)) {
        diagnostics.push(
          makeDiagnostic(
            line,
            "\\thanks{} may contain author-identifying affiliation information",
            "For double-blind review, \\thanks should not reveal author identity or affiliation",
            "Remove or anonymize the \\thanks{} content for blind review submission",
          ),
        );
        break;
      }
    }
  }

  const authorPattern = /\\author\s*\{([^}]*)\}/g;
  let authorMatch: RegExpExecArray | null;
  while ((authorMatch = authorPattern.exec(content)) !== null) {
    const authorBlock = authorMatch[1];
    const line = findLine(content, authorMatch.index);

    const fullNames = authorBlock.match(/(?:[A-Z][a-z]+\s+){2,}[A-Z][a-z]+/g);
    if (fullNames && fullNames.length > 0) {
      diagnostics.push(
        makeDiagnostic(
          line,
          "Author block contains full names that may compromise double-blind review",
          "For anonymous review, author names should be replaced with a placeholder or removed",
          "Replace author names with \\anonymous or remove the \\author{} block for blind review",
        ),
      );
    }
  }

  const selfCitePattern = /\\cite\s*\{([^}]*)\}/g;
  let selfCiteMatch: RegExpExecArray | null;
  while ((selfCiteMatch = selfCitePattern.exec(content)) !== null) {
    const citeKeys = selfCiteMatch[1].split(",").map((s) => s.trim());
    const line = findLine(content, selfCiteMatch.index);
    for (const key of citeKeys) {
      if (
        /^our/i.test(key) ||
        /^my/i.test(key) ||
        /^this/i.test(key) ||
        /^current/i.test(key) ||
        key.includes("our") ||
        key.includes("my-") ||
        key.includes("self")
      ) {
        diagnostics.push(
          makeDiagnostic(
            line,
            `Self-citation key "${key}" may reveal author identity`,
            'Citation keys starting with "our", "my", or containing identifying prefixes can compromise double-blind review',
            `Rename citation key "${key}" to a neutral identifier`,
          ),
        );
        break;
      }
    }
  }

  const urlPattern = /\\url\s*\{([^}]*)\}/g;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlPattern.exec(content)) !== null) {
    const url = urlMatch[1].toLowerCase();
    const line = findLine(content, urlMatch.index);
    const identifyingDomains = [
      "github.com/",
      "linkedin.com/in/",
      "twitter.com/",
      "personal",
      "homepage",
      "~",
    ];
    for (const domain of identifyingDomains) {
      if (url.includes(domain)) {
        diagnostics.push(
          makeDiagnostic(
            line,
            "URL may reveal author identity or affiliation",
            `URL "${urlMatch[1]}" could reveal the author's identity through personal pages or social media`,
            "Remove or anonymize URLs that link to personal profiles or homepages",
          ),
        );
        break;
      }
    }
  }

  const anonymizeRegex = /\\author\s*\{\s*(?:Anonymous|hidden|removed)/i;
  if (!anonymizeRegex.test(content)) {
    if (content.includes("\\documentclass") && !content.includes("\\author")) {
      diagnostics.push(
        makeDiagnostic(
          1,
          "Author block not anonymized for double-blind review",
          "The \\author{} block should be anonymized or removed for double-blind submissions",
          "Either remove \\author{} entirely or use a placeholder like \\author{Anonymous}",
        ),
      );
    }
  }

  return diagnostics;
}

function checkFigureResolutionImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const imagePattern = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(content)) !== null) {
    const filename = match[1];
    const line = findLine(content, match.index);
    const ext = filename.split(".").pop()?.toLowerCase();

    if (ext === "png") {
      diagnostics.push(
        makeDiagnostic(
          line,
          `PNG image "${filename}" may have insufficient resolution for print`,
          "PNG is a raster format and may appear pixelated in print; vector formats are preferred for publication-quality output",
          "Consider converting to PDF or EPS (vector format) for better print quality",
        ),
      );
    } else if (ext === "jpg" || ext === "jpeg") {
      diagnostics.push(
        makeDiagnostic(
          line,
          `JPEG image "${filename}" may introduce compression artifacts in print`,
          "JPEG uses lossy compression which can reduce quality; vector or high-resolution PNG is preferred",
          "Consider using PDF or a high-resolution PNG instead of JPEG for publication figures",
        ),
      );
    } else if (ext === "eps") {
      diagnostics.push(
        makeDiagnostic(
          line,
          `EPS image "${filename}" is a legacy format; PDF is preferred`,
          "EPS format may require special compiler flags (\\usepackage{epstopdf}) and is being phased out",
          "Convert to PDF format for better compatibility with modern LaTeX compilers",
        ),
      );
    } else if (!ext || ext === "pdf" || ext === "svg") {
      continue;
    } else {
      diagnostics.push(
        makeDiagnostic(
          line,
          `Unknown image format "${ext}" for "${filename}"`,
          "Uncommon image formats may not render correctly across all LaTeX compilers",
          "Use PDF, EPS, or PNG format for figures",
        ),
      );
    }
  }

  if (diagnostics.length > 0) {
    const hasEps = (content.match(/\\includegraphics.*\.eps\b/g) || []).length > 0;
    const hasPdf = (content.match(/\\includegraphics.*\.pdf\b/g) || []).length > 0;
    if (hasEps && !hasPdf) {
      diagnostics.push(
        makeDiagnostic(
          1,
          "Document uses EPS images but no PDF images; consider modern formats",
          "Many EPS images suggest a legacy workflow; modern publishers prefer PDF vector graphics",
          "Convert EPS files to PDF using epstopdf or include \\usepackage{epstopdf}",
        ),
      );
    }
  }

  return diagnostics;
}

function checkCompilerImpl(content: string, template: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const packagesRequiringCompilers: Record<string, string[]> = {
    pdflatex: [],
    xelatex: ["fontspec", "polyglossia", "xeCJK", "xunicode"],
    lualatex: ["fontspec", "luatexja", "luamplib", "luacode", "luatexko"],
  };

  const allPackages = new Set<string>();
  const usepackagePattern = /\\usepackage(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let pkgMatch: RegExpExecArray | null;
  while ((pkgMatch = usepackagePattern.exec(content)) !== null) {
    allPackages.add(pkgMatch[1]);
  }

  const compositePattern = /\\usepackage(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  compositePattern.lastIndex = 0;
  while ((pkgMatch = compositePattern.exec(content)) !== null) {
    const pkgs = pkgMatch[1].split(",").map((p) => p.trim());
    for (const p of pkgs) {
      allPackages.add(p);
    }
  }

  if (
    allPackages.has("fontspec") ||
    allPackages.has("polyglossia") ||
    allPackages.has("xeCJK")
  ) {
    let missingXeLaTeX = false;
    let line = 1;

    const fpMatch = content.match(/\\usepackage\s*(?:\[[^\]]*\])?\s*\{fontspec\}/);
    if (fpMatch) {
      line = findLine(content, fpMatch.index!);
      missingXeLaTeX = true;
    }
    const pgMatch = content.match(/\\usepackage\s*(?:\[[^\]]*\])?\s*\{polyglossia\}/);
    if (pgMatch && (!fpMatch || pgMatch.index! < fpMatch.index!)) {
      line = findLine(content, pgMatch.index!);
      missingXeLaTeX = true;
    }

    if (missingXeLaTeX) {
      diagnostics.push(
        makeDiagnostic(
          line,
          "Document requires XeLaTeX or LuaLaTeX compiler (fontspec/polyglossia detected)",
          "Packages like fontspec and polyglossia are not compatible with pdflatex and require XeLaTeX or LuaLaTeX",
          "Switch compiler to XeLaTeX or change to \\usepackage[T1]{fontenc} and \\usepackage[latin]{babel} for pdflatex",
        ),
      );
    }
  }

  if (
    allPackages.has("tikz") ||
    allPackages.has("pgfplots") ||
    allPackages.has("pstricks")
  ) {
    diagnostics.push(
      makeDiagnostic(
        1,
        "Graphics packages detected that may increase compilation time and complexity",
        "TikZ, pgfplots, and pstricks can significantly increase compilation time and may require specific compiler flags",
        "For tikz/pgfplots: use pdflatex or lualatex; for pstricks: use xelatex or dvips route",
      ),
    );
  }

  if (allPackages.has("microtype")) {
    if (template === "elsevier") {
      diagnostics.push(
        makeDiagnostic(
          1,
          "microtype package may not be compatible with Elsevier's class",
          "Elsevier's elsarticle class has known compatibility issues with microtype in certain configurations",
          "Test compilation with and without microtype; consider disabling for final submission if issues arise",
        ),
      );
    }
  }

  const compilerRecommended: Record<string, string> = {
    ieee: "pdflatex",
    acm: "pdflatex",
    springer: "pdflatex",
    elsevier: "pdflatex",
    neurips: "pdflatex",
    cvpr: "pdflatex",
  };

  if (allPackages.has("fontspec") || allPackages.has("polyglossia")) {
    const rec = compilerRecommended[template] || "pdflatex";
    if (rec === "pdflatex") {
      diagnostics.push(
        makeDiagnostic(
          1,
          `Compiler mismatch: ${template.toUpperCase()} template recommends ${rec} but document needs XeLaTeX/LuaLaTeX`,
          "The template's recommended compiler (pdflatex) does not support fontspec/polyglossia",
          "Either remove fontspec/polyglossia and use fontenc/babel, or verify the conference accepts XeLaTeX output",
        ),
      );
    }
  }

  if (allPackages.has("babel")) {
    diagnostics.push(
      makeDiagnostic(
        1,
        "babel package detected - verify compatibility with template",
        "Some conference templates have issues with the babel package, which may alter spacing and formatting",
        "Consider commenting out babel for final submission if formatting is affected",
      ),
    );
  }

  return diagnostics;
}

const templateClasses: [RegExp, ConferenceTemplate][] = [
  [/\{IEEEtran\}/, "ieee"],
  [/\{acmart\}/, "acm"],
  [/\{(?:sn-jnl|svjour3|llncs)\}/, "springer"],
  [/\{elsarticle\}/, "elsevier"],
  [/\{neurips[^}]*\}/, "neurips"],
  [/\{cvpr\}/, "cvpr"],
];

/** The template implied by the paper's active \documentclass, if known. */
export function detectConferenceTemplate(content: string): ConferenceTemplate | null {
  const match = content.match(/\\documentclass\s*(?:\[[^\]]*\])?\s*(\{[^}]*\})/);
  if (!match) return null;
  for (const [pattern, template] of templateClasses) {
    if (pattern.test(match[1]!)) return template;
  }
  return null;
}

export function runConferenceChecks(
  content: string,
  settings: ConferenceCheckerSettings,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!settings.enabled || !content) {
    return diagnostics;
  }

  // The paper's own \documentclass wins over the template picked in Settings.
  const template = detectConferenceTemplate(content) ?? settings.template;

  if (settings.checkMargins) {
    diagnostics.push(...checkMarginsImpl(content, template));
  }

  if (settings.checkFontSize) {
    diagnostics.push(...checkFontSizeImpl(content, template));
  }

  if (settings.checkAbstractLength) {
    diagnostics.push(...checkAbstractLengthImpl(content, template));
  }

  if (settings.checkKeywords) {
    diagnostics.push(...checkKeywordsImpl(content));
  }

  if (settings.checkFigureReferences) {
    diagnostics.push(...checkFigureReferencesImpl(content));
  }

  if (settings.checkTableReferences) {
    diagnostics.push(...checkTableReferencesImpl(content));
  }

  if (settings.checkBibliographyStyle) {
    diagnostics.push(...checkBibliographyStyleImpl(content, template));
  }

  if (settings.checkPageLimit) {
    diagnostics.push(...checkPageLimitImpl(content, template));
  }

  if (settings.checkAuthorInfo) {
    diagnostics.push(...checkAuthorInfoImpl(content));
  }

  if (settings.checkAnonymousReview) {
    diagnostics.push(...checkAnonymousReviewImpl(content));
  }

  if (settings.checkFigureResolution) {
    diagnostics.push(...checkFigureResolutionImpl(content));
  }

  // Font embedding is checked against the real PDF by the compliance checks;
  // guessing from the source only produced "verify your fonts" noise.

  if (settings.checkCompiler) {
    diagnostics.push(...checkCompilerImpl(content, template));
  }

  return diagnostics;
}
