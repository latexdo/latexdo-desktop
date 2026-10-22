import { describe, expect, it } from "vitest";
import { detectConferenceTemplate, runConferenceChecks } from "../conferenceChecker";
import type { ConferenceCheckerSettings, ConferenceTemplate } from "../../types";

type CheckName = Exclude<
  keyof ConferenceCheckerSettings,
  "enabled" | "template" | "customTemplate"
>;

const allOff: ConferenceCheckerSettings = {
  enabled: true,
  template: "custom",
  customTemplate: "",
  checkMargins: false,
  checkFontSize: false,
  checkAbstractLength: false,
  checkKeywords: false,
  checkFigureReferences: false,
  checkTableReferences: false,
  checkBibliographyStyle: false,
  checkPageLimit: false,
  checkAuthorInfo: false,
  checkAnonymousReview: false,
  checkFigureResolution: false,
  checkEmbeddedFonts: false,
  checkCompiler: false,
};

function messages(
  check: CheckName,
  content: string,
  template: ConferenceTemplate = "custom",
  customTemplate = "",
): string[] {
  return runConferenceChecks(content, {
    ...allOff,
    template,
    customTemplate,
    [check]: true,
  }).map((diagnostic) => diagnostic.message);
}

describe("template detection", () => {
  it.each([
    ["\\documentclass[conference]{IEEEtran}", "ieee"],
    ["\\documentclass{acmart}", "acm"],
    ["\\documentclass{llncs}", "springer"],
    ["\\documentclass{elsarticle}", "elsevier"],
    ["\\documentclass{neurips_2024}", "neurips"],
    ["\\documentclass{cvpr}", "cvpr"],
    ["\\documentclass{article}", null],
    ["no class", null],
  ])("%s -> %s", (content, template) => {
    expect(detectConferenceTemplate(content)).toBe(template);
  });

  it("reads the class from a custom template, falling back to custom", () => {
    expect(
      messages(
        "checkFontSize",
        "\\documentclass[12pt]{x}",
        "custom",
        "\\documentclass{acmart}",
      ),
    ).toEqual(["Font size 12pt may not comply with ACM requirements"]);
    expect(messages("checkFontSize", "\\documentclass[12pt]{x}", "custom")).toEqual([]);
  });
});

describe("margins", () => {
  it("asks for the IEEE conference/journal option", () => {
    expect(messages("checkMargins", "\\documentclass[10pt]{IEEEtran}")).toEqual([
      "IEEE document class missing [conference] option",
    ]);
    expect(messages("checkMargins", "\\documentclass[journal]{IEEEtran}")).toEqual([]);
  });

  it("asks for the ACM sigconf option", () => {
    expect(messages("checkMargins", "\\documentclass[acmsmall]{acmart}")).toEqual([
      "ACM document class missing [sigconf] option",
    ]);
    expect(messages("checkMargins", "\\documentclass[sigconf]{acmart}")).toEqual([]);
  });

  it("checks Springer sn-jnl options but not svjour3", () => {
    expect(messages("checkMargins", "\\documentclass[pdflatex]{sn-jnl}")).toEqual([
      "Springer document class may need [sn-mathphys-num] option",
    ]);
    expect(messages("checkMargins", "\\documentclass[sn-mathphys]{sn-jnl}")).toEqual(
      [],
    );
    expect(messages("checkMargins", "\\documentclass{svjour3}")).toEqual([]);
  });

  it.each([
    ["\\documentclass[conference]{IEEEtran}", "IEEE"],
    ["\\documentclass[sigconf]{acmart}", "ACM"],
    ["\\documentclass{svjour3}", "SPRINGER"],
    ["\\documentclass[review]{elsarticle}", "ELSEVIER"],
    ["\\documentclass{neurips_2024}", "NEURIPS"],
    ["\\documentclass[review]{cvpr}", "CVPR"],
  ])("flags custom geometry margins for %s", (cls, name) => {
    for (const option of [
      "margin=1in",
      "left=1cm",
      "right=1cm",
      "top=1cm",
      "bottom=1cm",
    ]) {
      const diagnostics = runConferenceChecks(
        `${cls}\n\\usepackage[${option}]{geometry}`,
        { ...allOff, checkMargins: true },
      );
      expect(diagnostics.at(-1)?.detail).toContain(`${name} template`);
      expect(diagnostics.at(-1)?.line).toBe(2);
    }
  });

  it("ignores geometry without margins or for unknown templates", () => {
    expect(
      messages("checkMargins", "\\documentclass{neurips_2024}\n\\usepackage{geometry}"),
    ).toEqual([]);
    expect(
      messages(
        "checkMargins",
        "\\documentclass{neurips_2024}\n\\usepackage[a4paper]{geometry}",
      ),
    ).toEqual([]);
    expect(messages("checkMargins", "\\usepackage[margin=1in]{geometry}")).toEqual([]);
  });

  it("flags manual offset and margin lengths", () => {
    expect(
      messages(
        "checkMargins",
        "\\setlength{\\hoffset}{-1in}\n\\oddsidemargin -10\n\\evensidemargin 5\n\\topmargin 0",
      ),
    ).toEqual([
      "Custom \\hoffset override detected",
      "Manual \\oddsidemargin override detected",
      "Manual \\evensidemargin override detected",
      "Manual \\topmargin override detected",
    ]);
  });
});

describe("font size", () => {
  it.each([
    ["ieee", "11pt", "Font size 11pt may not comply with IEEE requirements"],
    ["acm", "12pt", "Font size 12pt may not comply with ACM requirements"],
    ["springer", "10pt", "Font size 10pt may not comply with Springer requirements"],
  ] as const)("flags the wrong size for %s", (template, size, message) => {
    expect(messages("checkFontSize", `\\documentclass[${size}]{x}`, template)).toEqual([
      message,
    ]);
  });

  it.each([
    ["ieee", "10pt"],
    ["acm", "10pt"],
    ["springer", "12pt"],
    ["neurips", "11pt"],
  ] as const)("accepts %s at %s", (template, size) => {
    expect(messages("checkFontSize", `\\documentclass[${size}]{x}`, template)).toEqual(
      [],
    );
  });

  it("asks for an explicit size for IEEE and ACM only", () => {
    expect(messages("checkFontSize", "\\documentclass[a4paper]{x}", "ieee")).toEqual([
      "No explicit font size specified; IEEE requires 10pt",
    ]);
    expect(messages("checkFontSize", "\\documentclass[a4paper]{x}", "acm")).toEqual([
      "No explicit font size specified; ACM typically uses 10pt",
    ]);
    expect(messages("checkFontSize", "\\documentclass[a4paper]{x}", "cvpr")).toEqual(
      [],
    );
  });

  it("flags non-standard \\fontsize overrides", () => {
    expect(
      messages("checkFontSize", "\\fontsize{9pt}{11pt}\\fontsize{10pt}{12pt}", "cvpr"),
    ).toEqual(["Non-standard font size (9pt) override via \\fontsize"]);
  });
});

describe("abstract length", () => {
  const words = (count: number) => Array(count).fill("word").join(" ");

  it("reports a missing abstract", () => {
    expect(messages("checkAbstractLength", "text")).toEqual(["No abstract found"]);
  });

  it.each([
    ["ieee", 250],
    ["acm", 150],
    ["springer", 250],
    ["neurips", 200],
    ["cvpr", 250],
    ["elsevier", 250],
  ] as const)("uses the %s limit of %i words", (template, limit) => {
    const ok = `\\begin{abstract}${words(limit)}\\end{abstract}`;
    const long = `\\begin{abstract}${words(limit + 1)}\\end{abstract}`;
    expect(messages("checkAbstractLength", ok, template)).toEqual([]);
    expect(messages("checkAbstractLength", long, template)).toEqual([
      `Abstract exceeds ${template.toUpperCase()} word limit (${limit + 1} > ${limit} words)`,
    ]);
  });

  it("reads \\abstract{} and flags very short abstracts", () => {
    expect(messages("checkAbstractLength", "\n\\abstract{Too \\emph short}")).toEqual([
      "Abstract is very short (less than 50 words)",
    ]);
  });
});

describe("keywords", () => {
  it("requires keywords only in a real paper", () => {
    expect(messages("checkKeywords", "\\documentclass{x}")).toEqual([
      "Keywords section missing",
    ]);
    expect(messages("checkKeywords", "\\begin{abstract}")).toEqual([
      "Keywords section missing",
    ]);
    expect(messages("checkKeywords", "a snippet")).toEqual([]);
    expect(messages("checkKeywords", "\\documentclass{x}\\KW{a}")).toEqual([]);
    expect(messages("checkKeywords", "\\documentclass{x}\\keywords{a}")).toEqual([]);
  });
});

describe("figure and table references", () => {
  it("flags unreferenced figures and accepts the reference styles", () => {
    const content = [
      "\\begin{figure}[t]\\includegraphics{a.pdf}\\label{fig:a}\\end{figure}",
      "\\begin{figure}\\label{fig:b}\\end{figure}",
      "\\begin{figure}\\label{c}\\end{figure}",
      "\\begin{figure}\\label{d}\\end{figure}",
      "See \\ref{fig:a}, Figure~\\ref{c}, Fig.~\\ref{d}.",
    ].join("\n");
    expect(messages("checkFigureReferences", content)).toEqual([
      'Figure "fig:b" is not referenced in the text',
    ]);
  });

  it("ignores unlabelled figures and flags loose images", () => {
    expect(messages("checkFigureReferences", "\\begin{figure}\\end{figure}")).toEqual(
      [],
    );
    expect(
      messages("checkFigureReferences", "\\includegraphics[width=1cm]{x.png}"),
    ).toEqual(["\\includegraphics{x.png} used outside a figure environment"]);
  });

  it("flags unreferenced tables and accepts the reference styles", () => {
    const content = [
      "\\begin{table}[h]\\label{tab:a}\\end{table}",
      "\\begin{table}\\label{tab:b}\\end{table}",
      "\\begin{table}\\label{t3}\\end{table}",
      "\\begin{table}\\label{t4}\\end{table}",
      "\\begin{table}\\end{table}",
      "See \\ref{tab:a}, Table~\\ref{t3}, Tab.~\\ref{t4}, \\ref{other}.",
    ].join("\n");
    expect(messages("checkTableReferences", content)).toEqual([
      'Table "tab:b" is not referenced in the text',
    ]);
  });

  it("flags tabulars outside table environments", () => {
    expect(
      messages(
        "checkTableReferences",
        "\\begin{tabular}{c}\\end{tabular}\\begin{tabular}{c}",
      ),
    ).toEqual(["Found 2 tabular environment(s) but no table environments with labels"]);
  });
});

describe("bibliography style", () => {
  it.each([
    ["ieee", "IEEEtran", "ieeetr", "plain"],
    ["acm", "acm", "abbrv", "ieeetr"],
    ["springer", "spmpsi", "plain", "abbrv"],
    ["elsevier", "elsarticle-num", "model1-num-names", "plain"],
    ["neurips", "plain", "unsrt", "ieeetr"],
    ["cvpr", "plain", "abbrv", "unsrt"],
    ["custom", "plain", "elsarticle-num", "alpha"],
  ] as const)("%s recommends %s", (template, recommended, ok, bad) => {
    expect(
      messages("checkBibliographyStyle", `\\bibliographystyle{${ok}}`, template),
    ).toEqual([]);
    const diagnostics = runConferenceChecks(`\\bibliographystyle{${bad}}`, {
      ...allOff,
      template,
      checkBibliographyStyle: true,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].suggestion).toBe(
      `Change to \\bibliographystyle{${recommended}}`,
    );
  });

  it("asks for a style unless the template is custom or the style is set elsewhere", () => {
    expect(messages("checkBibliographyStyle", "text", "ieee")).toEqual([
      "No \\bibliographystyle{} found",
    ]);
    expect(messages("checkBibliographyStyle", "text", "custom")).toEqual([]);
    expect(
      messages("checkBibliographyStyle", "\\usepackage{biblatex}", "ieee"),
    ).toEqual([]);
    expect(messages("checkBibliographyStyle", "\\addbibresource{x}", "ieee")).toEqual(
      [],
    );
    expect(messages("checkBibliographyStyle", "\\documentclass[x]{sn-jnl}")).toEqual(
      [],
    );
  });
});

describe("page limit", () => {
  it.each([
    ["ieee", 6],
    ["acm", 10],
    ["springer", 25],
    ["elsevier", 25],
    ["neurips", 8],
    ["cvpr", 8],
    ["custom", 10],
  ] as const)("uses a %s limit of %i pages", (template, limit) => {
    const atLimit = "\\newpage".repeat(limit - 1);
    const over = atLimit + "\\clearpage";
    expect(messages("checkPageLimit", atLimit, template)).toEqual([]);
    expect(messages("checkPageLimit", over, template)[0]).toContain(
      `page limit (${limit})`,
    );
  });
});

describe("author information", () => {
  it("wants email and affiliation in each author block", () => {
    expect(messages("checkAuthorInfo", "\\author{Ada}\\maketitle")).toEqual([
      "Author block missing email address",
      "Author block missing affiliation/institution",
    ]);
    expect(
      messages("checkAuthorInfo", "\\author{Ada \\texttt{a} \\institute{U}}"),
    ).toEqual([]);
    expect(messages("checkAuthorInfo", "\\author{Ada a@b.c \\address{U}}")).toEqual([]);
    expect(
      messages(
        "checkAuthorInfo",
        "\\author*[1]{Ada \\email{x}}\\author{Bo \\email{y}}\\affil{U}",
      ),
    ).toEqual([]);
  });

  it("notices very many authors", () => {
    const names = Array(11).fill("A \\email{a}").join(" \\and ");
    expect(messages("checkAuthorInfo", `\\affiliation{U}\\author{${names}}`)).toEqual([
      "Large number of authors (11) detected",
    ]);
  });

  it("asks for authors only in a real paper", () => {
    expect(messages("checkAuthorInfo", "\\title{T}")).toEqual([
      "No \\author{} command found",
    ]);
    expect(messages("checkAuthorInfo", "\\documentclass{x}")).toEqual([
      "No \\author{} command found",
    ]);
    expect(messages("checkAuthorInfo", "snippet")).toEqual([]);
  });
});

describe("anonymous review", () => {
  it("flags identifying \\thanks text", () => {
    expect(messages("checkAnonymousReview", "\\thanks{Write to a@b.c}")).toEqual([
      "\\thanks{} may contain author-identifying information (email)",
    ]);
    expect(messages("checkAnonymousReview", "\\thanks{By e-mail, Prof. X}")).toEqual([
      "\\thanks{} may contain author-identifying information (email)",
      "\\thanks{} may contain author-identifying affiliation information",
    ]);
    expect(messages("checkAnonymousReview", "\\thanks{Funded by a grant}")).toEqual([]);
  });

  it("flags full names in author blocks", () => {
    expect(
      messages(
        "checkAnonymousReview",
        "\\documentclass{x}\\author{Ada Byron Lovelace}",
      ),
    ).toEqual([
      "Author block contains full names that may compromise double-blind review",
    ]);
    expect(messages("checkAnonymousReview", "\\author{Anonymous}")).toEqual([]);
  });

  it.each([
    "our2020",
    "myPaper",
    "thisWork",
    "currentWork",
    "prior-our",
    "my-x",
    "self20",
  ])("flags the self-citation key %s", (key) => {
    expect(messages("checkAnonymousReview", `\\cite{knuth, ${key}, ${key}}`)).toEqual([
      `Self-citation key "${key}" may reveal author identity`,
    ]);
  });

  it("ignores neutral citation keys", () => {
    expect(messages("checkAnonymousReview", "\\cite{knuth84}")).toEqual([]);
  });

  it.each([
    "https://github.com/me",
    "https://linkedin.com/in/me",
    "https://twitter.com/me",
    "https://x.edu/personal",
    "https://x.edu/homepage",
    "https://x.edu/~me",
  ])("flags the identifying URL %s", (url) => {
    expect(messages("checkAnonymousReview", `\\url{${url}}`)).toEqual([
      "URL may reveal author identity or affiliation",
    ]);
  });

  it("ignores neutral URLs and asks to anonymise a paper without authors", () => {
    expect(messages("checkAnonymousReview", "\\url{https://example.org/data}")).toEqual(
      [],
    );
    expect(messages("checkAnonymousReview", "\\documentclass{x}")).toEqual([
      "Author block not anonymized for double-blind review",
    ]);
  });
});

describe("figure resolution", () => {
  it("flags raster, legacy and unknown formats", () => {
    expect(
      messages(
        "checkFigureResolution",
        [
          "\\includegraphics{a.png}",
          "\\includegraphics{b.JPG}",
          "\\includegraphics{c.jpeg}",
          "\\includegraphics{d.bmp}",
          "\\includegraphics{e.pdf}",
          "\\includegraphics{f.svg}",
          "\\includegraphics{noext}",
        ].join("\n"),
      ),
    ).toEqual([
      'PNG image "a.png" may have insufficient resolution for print',
      'JPEG image "b.JPG" may introduce compression artifacts in print',
      'JPEG image "c.jpeg" may introduce compression artifacts in print',
      'Unknown image format "bmp" for "d.bmp"',
      'Unknown image format "noext" for "noext"',
    ]);
  });

  it("suggests modern formats when only EPS figures are used", () => {
    expect(messages("checkFigureResolution", "\\includegraphics{a.eps}")).toEqual([
      'EPS image "a.eps" is a legacy format; PDF is preferred',
      "Document uses EPS images but no PDF images; consider modern formats",
    ]);
    expect(
      messages(
        "checkFigureResolution",
        "\\includegraphics{a.eps}\n\\includegraphics{b.pdf}",
      ),
    ).toEqual(['EPS image "a.eps" is a legacy format; PDF is preferred']);
  });
});

describe("compiler", () => {
  it("flags fontspec and polyglossia, at the earliest line", () => {
    expect(messages("checkCompiler", "\\usepackage{fontspec}", "ieee")).toEqual([
      "Document requires XeLaTeX or LuaLaTeX compiler (fontspec/polyglossia detected)",
      "Compiler mismatch: IEEE template recommends pdflatex but document needs XeLaTeX/LuaLaTeX",
    ]);
    const diagnostics = runConferenceChecks(
      "x\n\\usepackage{polyglossia}\n\\usepackage{fontspec}",
      { ...allOff, checkCompiler: true },
    );
    expect(diagnostics[0].line).toBe(2);
    const fontspecFirst = runConferenceChecks(
      "\\usepackage{fontspec}\n\\usepackage{polyglossia}",
      { ...allOff, checkCompiler: true },
    );
    expect(fontspecFirst[0].line).toBe(1);
  });

  it("does not ask for XeLaTeX when only xeCJK comes via a package list", () => {
    expect(messages("checkCompiler", "\\usepackage{xeCJK}")).toEqual([]);
    expect(messages("checkCompiler", "\\usepackage{amsmath, polyglossia}")).toEqual([
      "Compiler mismatch: CUSTOM template recommends pdflatex but document needs XeLaTeX/LuaLaTeX",
    ]);
  });

  it.each(["tikz", "pgfplots", "pstricks"])("notes the graphics package %s", (pkg) => {
    expect(messages("checkCompiler", `\\usepackage{${pkg}}`)).toEqual([
      "Graphics packages detected that may increase compilation time and complexity",
    ]);
  });

  it("warns about microtype only for Elsevier, and about babel", () => {
    expect(messages("checkCompiler", "\\usepackage{microtype}", "elsevier")).toEqual([
      "microtype package may not be compatible with Elsevier's class",
    ]);
    expect(messages("checkCompiler", "\\usepackage{microtype}", "ieee")).toEqual([]);
    expect(messages("checkCompiler", "\\usepackage[english]{babel}")).toEqual([
      "babel package detected - verify compatibility with template",
    ]);
  });
});
