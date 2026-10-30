import { countLatexWords } from "../latex/wordCount";
import type { Diagnostic, StructureAssistantSettings } from "../types";
import { looksLikeMachineLearning } from "./reproducibility";

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
): Diagnostic {
  return {
    file: "check",
    line,
    column: 1,
    severity: "warning",
    source: "structure-assistant" as Diagnostic["source"],
    message,
    detail,
    suggestion,
  };
}

function checkAbstractStructureImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

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

  if (!abstractText) {
    diagnostics.push(
      makeDiagnostic(
        1,
        "Abstract not found",
        "The document does not contain a recognizable abstract section",
        "Add \\begin{abstract}...\\end{abstract} or \\abstract{...} to summarize the paper",
      ),
    );
    return diagnostics;
  }

  const cleaned = abstractText
    .replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/[{}]/g, "");
  const wordCount = countLatexWords(content).abstract;
  const lc = cleaned.toLowerCase();

  if (wordCount < 50) {
    diagnostics.push(
      makeDiagnostic(
        abstractLine,
        `Abstract is very short (${wordCount} words)`,
        `A strong abstract should be at least 50 words to adequately summarize the paper; it currently has ${wordCount} words`,
        "Expand the abstract to cover problem, method, results, and contribution",
      ),
    );
  }

  const elements: {
    name: string;
    patterns: RegExp[];
    suggestion: string;
    found: boolean;
  }[] = [
    {
      name: "problem statement",
      patterns: [/\b(problem|challenge|limitation|issue|gap|remains)\b/i],
      suggestion:
        'State the problem, limitation, or gap the paper addresses (e.g., "existing methods struggle with...")',
      found: false,
    },
    {
      name: "method/approach",
      patterns: [/\b(propose|introduce|present|method|approach|framework|novel)\b/i],
      suggestion:
        'Describe the proposed method or approach (e.g., "we propose a novel framework that...")',
      found: false,
    },
    {
      name: "result",
      patterns: [
        /\b(result|achieve|outperform|improve|accuracy|experiment|show|demonstrate|obtain)\b/i,
      ],
      suggestion:
        'Summarize key results (e.g., "our method achieves 95% accuracy, outperforming baselines by...")',
      found: false,
    },
    {
      name: "contribution",
      patterns: [/\b(contribution|contribute|key insight|first)\b/i],
      suggestion:
        'Highlight the main contributions (e.g., "our key contribution is...")',
      found: false,
    },
  ];

  for (const el of elements) {
    for (const pattern of el.patterns) {
      if (pattern.test(lc)) {
        el.found = true;
        break;
      }
    }
    if (!el.found) {
      diagnostics.push(
        makeDiagnostic(
          abstractLine,
          `Abstract missing ${el.name}`,
          `The abstract does not contain language indicating a clear ${el.name}`,
          el.suggestion,
        ),
      );
    }
  }

  return diagnostics;
}

function checkIntroductionStructureImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const introSection = content.match(
    /\\section\s*\{[Ii]ntroduction\s*\}?([\s\S]*?)(?=\\section\s*\{)/,
  );

  if (!introSection) {
    diagnostics.push(
      makeDiagnostic(
        1,
        "Introduction section not found",
        "No \\section{Introduction} was detected in the document",
        "Add a \\section{Introduction} with motivation, gap, contributions, and outline",
      ),
    );
    return diagnostics;
  }

  const introText = introSection[1];
  const introLine = findLine(content, introSection.index!);
  const lc = introText.toLowerCase();

  const elements: {
    name: string;
    patterns: RegExp[];
    suggestion: string;
  }[] = [
    {
      name: "motivation",
      patterns: [
        /\b(important|critical|essential|widespread|growing|demand|need|key)\b/i,
      ],
      suggestion:
        'Include motivation for why the problem matters (e.g., "this problem is critical because...")',
    },
    {
      name: "gap identification",
      patterns: [
        /\b(however|but|yet|limited|lack|insufficient|remain|challenge|open problem)\b/i,
      ],
      suggestion:
        'Identify gaps in prior work (e.g., "however, existing approaches are limited by...")',
    },
    {
      name: "contribution",
      patterns: [
        /\b(contribution|we propose|this paper|our work|present|introduce)\b/i,
      ],
      suggestion:
        'Clearly state the paper\'s contributions (e.g., "our contributions include...")',
    },
    {
      name: "outline/roadmap",
      patterns: [/\b(organized as follows|structure|rest of this paper|section)\b/i],
      suggestion:
        'Provide a roadmap of the paper (e.g., "the rest of this paper is organized as follows...")',
    },
  ];

  for (const el of elements) {
    let found = false;
    for (const pattern of el.patterns) {
      if (pattern.test(lc)) {
        found = true;
        break;
      }
    }
    if (!found) {
      diagnostics.push(
        makeDiagnostic(
          introLine,
          `Introduction missing ${el.name}`,
          `The introduction does not contain a clear ${el.name}`,
          el.suggestion,
        ),
      );
    }
  }

  return diagnostics;
}

function checkRelatedWorkLengthImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const relatedSections: { text: string; line: number }[] = [];
  const sectionRegex =
    /\\section\s*\{([^}]*[Rr]elated\s*[Ww]ork[^}]*)\}\s*([\s\S]*?)(?=\\section\s*\{|\\bibliography|\\end\s*\{document\})/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    relatedSections.push({
      text: match[2],
      line: findLine(content, match.index!),
    });
  }

  if (relatedSections.length === 0) {
    // Section titles vary too much between fields to require this one.
    return diagnostics;
  }

  for (const section of relatedSections) {
    const lines = section.text.split("\n").filter((l) => l.trim()).length;
    const words = countWords(section.text);

    if (lines < 20) {
      diagnostics.push(
        makeDiagnostic(
          section.line,
          `Related Work section is too brief (${lines} lines, ${words} words)`,
          `A comprehensive related work section should typically be at least 20 lines; this section has ${lines} lines`,
          "Expand the related work section to provide adequate coverage of prior research",
        ),
      );
    }

    const citeMatches = section.text.match(/\\cite(?:[tp]?\*?)?\{[^}]*\}/g);
    const citeCount = citeMatches ? citeMatches.length : 0;

    if (citeCount < 5) {
      diagnostics.push(
        makeDiagnostic(
          section.line,
          `Related Work cites only ${citeCount} reference(s)`,
          `A thorough related work section should cite at least 5-10 relevant papers; this section cites ${citeCount}`,
          "Add more citations to cover the breadth of related research",
        ),
      );
    }

    const years: number[] = [];
    const yearRegex = /\(?(19\d{2}|20\d{2})\)?/g;
    let yrMatch: RegExpExecArray | null;
    while ((yrMatch = yearRegex.exec(section.text)) !== null) {
      years.push(parseInt(yrMatch[1], 10));
    }

    if (years.length >= 3) {
      const recentYears = years.filter((y) => y >= new Date().getFullYear() - 3);
      if (recentYears.length === 0) {
        diagnostics.push(
          makeDiagnostic(
            section.line,
            "Related Work lacks recent citations (none from the last 3 years)",
            `The most recent citation year found in this section is ${Math.max(...years)}, which may indicate the literature review is outdated`,
            "Search for and cite recent papers from the last 3 years to ensure the review is current",
          ),
        );
      }
    }
  }

  return diagnostics;
}

function checkMethodReproducibilityImpl(
  content: string,
  machineLearning: boolean,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const methodSection = content.match(
    /\\section\s*\{[^}]*(?:[Mm]ethod|[Mm]ethodology|[Pp]roposed|[Aa]pproach)[^}]*\}\s*([\s\S]*?)(?=\\section\s*\{|\\bibliography|\\end\s*\{document\})/,
  );

  if (!methodSection) {
    // Section titles vary too much between fields to require this one.
    return diagnostics;
  }

  // Pseudocode, equations and hyperparameters are what ML and algorithms
  // papers owe the reader; other methods sections are not judged by them.
  if (!machineLearning) return diagnostics;
  const methodText = methodSection[1];
  const methodLine = findLine(content, methodSection.index!);
  const lc = methodText.toLowerCase();

  const indicators: { name: string; pattern: RegExp; message: string }[] = [
    {
      name: "algorithm or pseudocode",
      pattern:
        /\\begin\s*\{algorithm\}|\\algorithm\b|\\begin\s*\{algorithmic\}|pseudo-?code/i,
      message:
        "No algorithm or pseudocode found; including one improves reproducibility",
    },
    {
      name: "dataset or implementation details",
      pattern: /\b(dataset|implementation|code|available|open-source|github)\b/i,
      message: "No mention of datasets, implementation, or code availability",
    },
    {
      name: "hyperparameters or configuration",
      pattern:
        /\b(hyperparameter|parameter setting|configuration|learning rate|batch size|epoch|optimizer)\b/i,
      message: "No hyperparameter or configuration details found",
    },
    {
      name: "mathematical formulation",
      pattern: /\\begin\s*\{equation\}|\\begin\s*\{align\}|\\\[\s*[^\[\]]*\\\]/,
      message:
        "No mathematical formulation (equations/align) found in the method section",
    },
    {
      name: "training or experimental setup",
      pattern:
        /\b(training details|experimental setup|implementation details|we set|we use|configured)\b/i,
      message: "No training or experimental setup details found",
    },
  ];

  for (const ind of indicators) {
    if (!ind.pattern.test(methodText)) {
      diagnostics.push(
        makeDiagnostic(
          methodLine,
          `Method section missing ${ind.name}`,
          ind.message,
          `Consider adding ${ind.name} details to improve reproducibility`,
        ),
      );
    }
  }

  const foundIndicators = indicators.filter((ind) => ind.pattern.test(methodText));
  if (foundIndicators.length < 2) {
    diagnostics.push(
      makeDiagnostic(
        methodLine,
        "Method section lacks sufficient reproducibility details",
        `Only ${foundIndicators.length} of ${indicators.length} reproducibility indicators were found`,
        "Add algorithm descriptions, mathematical formulation, hyperparameter settings, and implementation details",
      ),
    );
  }

  return diagnostics;
}

function checkResultsDiscussionImpl(
  content: string,
  machineLearning: boolean,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const resultsSection = content.match(
    /\\section\s*\{[^}]*(?:[Rr]esults?|[Ee]valuation|[Ee]xperiments?|[Ee]xperimental\s+[Rr]esults)[^}]*\}\s*([\s\S]*?)(?=\\section\s*\{|\\bibliography|\\end\s*\{document\})/,
  );

  if (!resultsSection) {
    // Section titles vary too much between fields to require this one.
    return diagnostics;
  }

  const resultsText = resultsSection[1];
  const resultsLine = findLine(content, resultsSection.index!);
  const lc = resultsText.toLowerCase();

  const hasNumericalResults =
    /\b\d+%|\b\d+\.\d+\b|\\begin\s*\{table\}|\\begin\s*\{figure\}/.test(resultsText);

  if (!hasNumericalResults) {
    diagnostics.push(
      makeDiagnostic(
        resultsLine,
        "Results section lacks numerical results",
        "No percentages, numerical values, tables, or figures were detected in the results section",
        "Include quantitative results with tables, figures, or numerical comparisons to baselines",
      ),
    );
  }

  const hasDiscussions =
    /\b(discuss|explain|reason|because|due to|interesting|notably|however|surprising)\b/i.test(
      lc,
    );
  if (!hasDiscussions) {
    diagnostics.push(
      makeDiagnostic(
        resultsLine,
        "Results section lacks discussion and analysis",
        "No discussion language (e.g., 'because', 'due to', 'interestingly') was detected",
        "Add analysis explaining why certain results occur, not just reporting numbers",
      ),
    );
  }

  if (!machineLearning) return diagnostics;

  const hasComparisons =
    /\b(compared to|better than|worse than|similar to|baseline|competitor)\b/i.test(lc);
  if (!hasComparisons) {
    diagnostics.push(
      makeDiagnostic(
        resultsLine,
        "Results section lacks comparison to baselines",
        "No baseline comparison language was detected (e.g., 'better than', 'compared to', 'baseline')",
        "Explicitly compare results against baseline methods and prior work",
      ),
    );
  }

  const hasAblation = /\b(ablation|analysis|impact of|effect of)\b/i.test(lc);
  if (!hasAblation) {
    diagnostics.push(
      makeDiagnostic(
        resultsLine,
        "Results section lacks ablation or analysis studies",
        "No ablation or component analysis was detected",
        "Consider adding an ablation study to analyze the impact of each component",
      ),
    );
  }

  const hasTables = /\\begin\s*\{table\}/.test(resultsText);
  const hasFigures = /\\begin\s*\{figure\}/.test(resultsText);

  if (!hasTables && !hasFigures) {
    diagnostics.push(
      makeDiagnostic(
        resultsLine,
        "Results section contains no tables or figures",
        "Results are typically presented using tables or figures for clarity",
        "Add \\begin{table}...\\end{table} or \\begin{figure}...\\end{figure} to present results visually",
      ),
    );
  }

  return diagnostics;
}

function checkConclusionClaimsImpl(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const conclusionSection = content.match(
    /\\section\s*\{[^}]*(?:[Cc]onclusion[s]?|[Ss]ummary)[^}]*\}\s*([\s\S]*?)(?=\\section\*?\s*\{|\\bibliography|\\backmatter|\\bmhead|\\appendix|\\begin\s*\{appendices\}|\\end\s*\{document\})/,
  );

  if (!conclusionSection) {
    diagnostics.push(
      makeDiagnostic(
        1,
        "Conclusion section not found",
        "No recognizable conclusion or summary section was detected",
        "Add a \\section{Conclusion} to summarize findings, discuss limitations, and outline future work",
      ),
    );
    return diagnostics;
  }

  const conclusionText = conclusionSection[1];
  const conclusionLine = findLine(content, conclusionSection.index!);
  const lc = conclusionText.toLowerCase();

  // An unwritten conclusion is one finding, not one per missing part.
  if (countWords(conclusionText.replace(/\\[a-zA-Z]+\*?(?:\{[^}]*\})?/g, " ")) < 30) {
    diagnostics.push(
      makeDiagnostic(
        conclusionLine,
        "Conclusion is empty",
        "Summarize the findings, state the limitations and suggest future work.",
        "Write the conclusion.",
      ),
    );
    return diagnostics;
  }

  const hasSummary =
    /\b(we presented|we showed|we demonstrated|we proposed|we introduced|we presented|we achieve|we obtain|summary|summarize|overall)\b/i.test(
      lc,
    );
  if (!hasSummary) {
    diagnostics.push(
      makeDiagnostic(
        conclusionLine,
        "Conclusion missing summary of findings",
        "The conclusion should summarize the key findings and contributions of the paper",
        "Restate the main results and contributions using phrases like 'we demonstrated that...' or 'our experiments show...'",
      ),
    );
  }

  const hasLimitations =
    /\b(limitation|limitation|drawback|weakness|caveat|scope|constraint|not general|assumption)\b/i.test(
      lc,
    );
  if (!hasLimitations) {
    diagnostics.push(
      makeDiagnostic(
        conclusionLine,
        "Conclusion missing limitations discussion",
        "The conclusion does not acknowledge limitations of the work",
        "Add a paragraph discussing limitations (e.g., 'our approach has several limitations...')",
      ),
    );
  }

  const hasFutureWork = /\b(future work|future research|next|future direction)\b/i.test(
    lc,
  );
  if (!hasFutureWork) {
    diagnostics.push(
      makeDiagnostic(
        conclusionLine,
        "Conclusion missing future work",
        "The conclusion does not suggest directions for future research",
        "Include a statement about future work (e.g., 'future work could explore...')",
      ),
    );
  }

  const introduceNewTerms = /\b(surprising|unexpected|novel|first)\b/i.test(lc);
  if (introduceNewTerms) {
    diagnostics.push(
      makeDiagnostic(
        conclusionLine,
        "Conclusion may introduce new claims not supported earlier",
        "The conclusion uses language (e.g., 'surprising', 'unexpected', 'novel', 'first') that may indicate new claims not discussed in earlier sections",
        "Ensure all claims in the conclusion are supported by evidence presented earlier in the paper",
      ),
    );
  }

  return diagnostics;
}

export function runStructureChecks(
  content: string,
  settings: StructureAssistantSettings,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!settings.enabled || !content) {
    return diagnostics;
  }

  const machineLearning = looksLikeMachineLearning(content);

  if (settings.checkAbstractStructure) {
    diagnostics.push(...checkAbstractStructureImpl(content));
  }

  if (settings.checkIntroductionStructure) {
    diagnostics.push(...checkIntroductionStructureImpl(content));
  }

  if (settings.checkRelatedWorkLength) {
    diagnostics.push(...checkRelatedWorkLengthImpl(content));
  }

  if (settings.checkMethodReproducibility) {
    diagnostics.push(...checkMethodReproducibilityImpl(content, machineLearning));
  }

  if (settings.checkResultsDiscussion) {
    diagnostics.push(...checkResultsDiscussionImpl(content, machineLearning));
  }

  if (settings.checkConclusionClaims) {
    diagnostics.push(...checkConclusionClaimsImpl(content));
  }

  return diagnostics;
}
