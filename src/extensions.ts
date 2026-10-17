export type ExtensionCategory =
  | "bibliography"
  | "checking"
  | "graphics"
  | "templates"
  | "writing"
  | "workflow";

export type LatexDoExtensionKind = "extension" | "template";

export type ExtensionFeatureFlag =
  | "acronymManagerEnabled"
  | "autoFixCommon"
  | "checkAbstractWordCount"
  | "checkCodeLink"
  | "checkDatasetLink"
  | "checkEmbeddedFonts"
  | "checkEvaluationMetrics"
  | "checkFigureReferences"
  | "checkHardwareDetails"
  | "checkHyperparameters"
  | "checkLicenseMentioned"
  | "checkPageCount"
  | "checkRandomSeeds"
  | "checkSectionsWithNoCitations"
  | "checkTableReferences"
  | "checkType3Fonts"
  | "checkUncitedCitations"
  | "checkUndefinedAcronym"
  | "checkUnreferencedFigures"
  | "citationAssistantEnabled"
  | "conferenceCheckerEnabled"
  | "detectBrokenLinks"
  | "detectDuplicateReferences"
  | "detectMissingCitations"
  | "detectNotation"
  | "detectNotationConflicts"
  | "detectUndefinedNotation"
  | "detectUnusedEntries"
  | "errorDoctorEnabled"
  | "explainErrors"
  | "importMetadataSources"
  | "notationManagerEnabled"
  | "pdfComplianceEnabled"
  | "projectBibliographyEnabled"
  | "reproducibilityEnabled"
  | "structureAssistantEnabled"
  | "suggestCitationKeys"
  | "suggestFixes"
  | "tableGeneratorEnabled"
  | "tikzConverterAutoOpen"
  | "tikzConverterEnabled"
  | "warnOldCitations";

export interface LatexDoExtensionSnippet {
  label: string;
  insertText: string;
  detail?: string;
  documentation?: string;
}

export interface LatexDoExtensionTemplate {
  id: string;
  name: string;
  summary: string;
  files: string;
  mainTex: string;
  bibTex?: string;
}

export interface LatexDoExtensionContributions {
  featureFlags?: Partial<Record<ExtensionFeatureFlag, boolean>>;
  snippets?: LatexDoExtensionSnippet[];
  templates?: LatexDoExtensionTemplate[];
}

export interface LatexDoExtensionManifest {
  schemaVersion: 1;
  id: string;
  kind: LatexDoExtensionKind;
  name: string;
  version: string;
  description: string;
  author: string;
  category: ExtensionCategory;
  tags: string[];
  homepage?: string;
  repository?: string;
  /** Images or GIFs of the extension at work, hosted on latexdo.org. */
  screenshots?: ExtensionScreenshot[];
  contributes: LatexDoExtensionContributions;
}

export interface ExtensionScreenshot {
  url: string;
  caption?: string;
}

export interface LatexDoExtensionCatalog {
  schemaVersion: 1;
  product: "LatexDo";
  updatedAt: string;
  extensions: LatexDoExtensionManifest[];
}

export interface ExtensionCatalogLoadResult {
  catalog: LatexDoExtensionCatalog;
  source: "remote" | "fallback";
  error?: string;
}

type ExtensionCatalogJsonLoader = (catalogUrl: string) => Promise<unknown>;

export const extensionStoreCatalogUrl =
  import.meta.env?.VITE_LATEXDO_EXTENSION_CATALOG_URL?.trim() ||
  "https://latexdo.org/store/extensions/catalog.json";

export const extensionCategories: ExtensionCategory[] = [
  "writing",
  "checking",
  "bibliography",
  "graphics",
  "templates",
  "workflow",
];

const extensionFeatureFlags = new Set<ExtensionFeatureFlag>([
  "acronymManagerEnabled",
  "autoFixCommon",
  "checkAbstractWordCount",
  "checkCodeLink",
  "checkDatasetLink",
  "checkEmbeddedFonts",
  "checkEvaluationMetrics",
  "checkFigureReferences",
  "checkHardwareDetails",
  "checkHyperparameters",
  "checkLicenseMentioned",
  "checkPageCount",
  "checkRandomSeeds",
  "checkSectionsWithNoCitations",
  "checkTableReferences",
  "checkType3Fonts",
  "checkUncitedCitations",
  "checkUndefinedAcronym",
  "checkUnreferencedFigures",
  "citationAssistantEnabled",
  "conferenceCheckerEnabled",
  "detectBrokenLinks",
  "detectDuplicateReferences",
  "detectMissingCitations",
  "detectNotation",
  "detectNotationConflicts",
  "detectUndefinedNotation",
  "detectUnusedEntries",
  "errorDoctorEnabled",
  "explainErrors",
  "importMetadataSources",
  "notationManagerEnabled",
  "pdfComplianceEnabled",
  "projectBibliographyEnabled",
  "reproducibilityEnabled",
  "structureAssistantEnabled",
  "suggestCitationKeys",
  "suggestFixes",
  "tableGeneratorEnabled",
  "tikzConverterAutoOpen",
  "tikzConverterEnabled",
  "warnOldCitations",
]);

const extensionIdPattern = /^[a-z0-9][a-z0-9.-]{2,80}$/;
const extensionVersionPattern = /^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][a-z0-9.-]+)?$/i;

/** The store extension that adds the Figure → TikZ Converter. */
export const figureToTikzExtensionId = "latexdo.figure-to-tikz";

/** True when an installed extension adds the Figure → TikZ Converter. */
export function hasFigureToTikzExtension(
  installed: readonly LatexDoExtensionManifest[],
): boolean {
  return installed.some(
    (extension) => extension.contributes.featureFlags?.tikzConverterEnabled === true,
  );
}

export const fallbackExtensionCatalog: LatexDoExtensionCatalog = {
  schemaVersion: 1,
  product: "LatexDo",
  updatedAt: "2026-10-15T00:00:00.000Z",
  // Templates, snippets and optional tools LatexDo does not ship by default.
  // Core tools (tables, TikZ drawing, notation, citations, checks) need no install.
  extensions: [
    {
      schemaVersion: 1,
      id: figureToTikzExtensionId,
      kind: "extension",
      name: "Figure → TikZ Converter",
      version: "1.0.0",
      description:
        "Turn a draw.io diagram or an image into editable TikZ code, so figures use the paper's fonts and stay sharp at any size.",
      author: "LatexDo",
      category: "graphics",
      tags: ["tikz", "figures", "draw.io", "convert"],
      homepage: `https://latexdo.org/store/extensions/${figureToTikzExtensionId}/`,
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        featureFlags: { tikzConverterEnabled: true },
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.ieee-conference",
      kind: "template",
      name: "IEEE Conference Paper",
      version: "1.0.0",
      description:
        "An IEEE two-column conference paper with authors, keywords, a results table and IEEE references, ready to submit.",
      author: "LatexDo",
      category: "templates",
      tags: ["ieee", "conference", "paper"],
      homepage: "https://latexdo.org/store/extensions/latexdo.ieee-conference/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        templates: [
          {
            id: "ieee-conference-paper",
            name: "IEEE Conference Paper",
            summary:
              "Two-column IEEEtran paper with author blocks, keywords, a booktabs results table and IEEE-style references.",
            files: "main.tex, references.bib",
            mainTex:
              "\\documentclass[conference]{IEEEtran}\n\n\\usepackage{amsmath,amssymb}\n\\usepackage{graphicx}\n\\usepackage{booktabs}\n\\usepackage{cite}\n\\usepackage[hidelinks]{hyperref}\n\n\\begin{document}\n\n\\title{Paper Title: A Short, Specific Claim}\n\n\\author{\n  \\IEEEauthorblockN{First Author}\n  \\IEEEauthorblockA{Department, University\\\\\n  City, Country\\\\\n  first.author@example.org}\n  \\and\n  \\IEEEauthorblockN{Second Author}\n  \\IEEEauthorblockA{Department, University\\\\\n  City, Country\\\\\n  second.author@example.org}\n}\n\n\\maketitle\n\n\\begin{abstract}\nState the problem, the approach, the main result with a number, and why it matters, in about 150 words.\n\\end{abstract}\n\n\\begin{IEEEkeywords}\nfirst keyword, second keyword, third keyword\n\\end{IEEEkeywords}\n\n\\section{Introduction}\nMotivate the problem and list the contributions.\n\n\\begin{itemize}\n  \\item The first contribution.\n  \\item The second contribution.\n\\end{itemize}\n\n\\section{Related Work}\nPosition the paper against prior work~\\cite{example2024}.\n\n\\section{Method}\n\\label{sec:method}\nDescribe the approach. Equations are numbered:\n\\begin{equation}\n  \\mathcal{L}(\\theta) = \\sum_{i=1}^{n} \\ell\\bigl(f_\\theta(x_i), y_i\\bigr).\n  \\label{eq:loss}\n\\end{equation}\n\n\\section{Experiments}\n\\begin{table}[t]\n  \\centering\n  \\caption{Main results. Best in bold.}\n  \\label{tab:results}\n  \\begin{tabular}{lcc}\n    \\toprule\n    Method & Accuracy (\\%) & Time (s) \\\\\n    \\midrule\n    Baseline & 81.2 & 12.4 \\\\\n    Ours & \\textbf{86.9} & \\textbf{9.1} \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n\nTable~\\ref{tab:results} summarises the results.\n\n\\section{Conclusion}\nSummarise the findings and the limits.\n\n\\bibliographystyle{IEEEtran}\n\\bibliography{references}\n\n\\end{document}\n",
            bibTex:
              "@inproceedings{example2024,\n  author = {Doe, Jane and Roe, Richard},\n  title = {An Example Reference},\n  booktitle = {Proceedings of an Example Conference},\n  year = {2024},\n  pages = {1--10}\n}\n",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.acm-article",
      kind: "template",
      name: "ACM Article",
      version: "1.0.0",
      description:
        "An ACM sigconf article in anonymous review mode with affiliations, keywords and ACM references, one switch from camera-ready.",
      author: "LatexDo",
      category: "templates",
      tags: ["acm", "sigconf", "paper"],
      homepage: "https://latexdo.org/store/extensions/latexdo.acm-article/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        templates: [
          {
            id: "acm-sigconf-article",
            name: "ACM Conference Article",
            summary:
              "acmart sigconf article in anonymous review mode, with affiliations, keywords, results table and ACM references.",
            files: "main.tex, references.bib",
            mainTex:
              '\\documentclass[sigconf,review,anonymous]{acmart}\n\n% Remove "review,anonymous" for the camera-ready version.\n\\setcopyright{none}\n\\settopmatter{printacmref=false}\n\n\\begin{document}\n\n\\title{Paper Title: A Short, Specific Claim}\n\n\\author{First Author}\n\\affiliation{%\n  \\institution{University}\n  \\city{City}\n  \\country{Country}}\n\\email{first.author@example.org}\n\n\\author{Second Author}\n\\affiliation{%\n  \\institution{Institute}\n  \\city{City}\n  \\country{Country}}\n\\email{second.author@example.org}\n\n\\begin{abstract}\nState the problem, the approach, the main result with a number, and why it matters.\n\\end{abstract}\n\n\\keywords{first keyword, second keyword, third keyword}\n\n\\maketitle\n\n\\section{Introduction}\nMotivate the problem and list the contributions.\n\n\\section{Related Work}\nPosition the paper against prior work~\\cite{example2024}.\n\n\\section{Approach}\n\\label{sec:approach}\nDescribe the system or method.\n\n\\section{Evaluation}\n\\begin{table}[t]\n  \\caption{Main results. Best in bold.}\n  \\label{tab:results}\n  \\begin{tabular}{lcc}\n    \\toprule\n    Method & Accuracy (\\%) & Latency (ms) \\\\\n    \\midrule\n    Baseline & 81.2 & 34 \\\\\n    Ours & \\textbf{86.9} & \\textbf{21} \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n\n\\section{Conclusion}\nSummarise the findings and the limits.\n\n\\begin{acks}\nAcknowledge funding and help here.\n\\end{acks}\n\n\\bibliographystyle{ACM-Reference-Format}\n\\bibliography{references}\n\n\\end{document}\n',
            bibTex:
              "@inproceedings{example2024,\n  author = {Doe, Jane and Roe, Richard},\n  title = {An Example Reference},\n  booktitle = {Proceedings of an Example Conference},\n  year = {2024},\n  pages = {1--10}\n}\n",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.thesis",
      kind: "template",
      name: "Thesis and Dissertation",
      version: "1.0.0",
      description:
        "A thesis or dissertation with title page, abstract, acknowledgements, contents, lists of figures and tables, chapters and appendix.",
      author: "LatexDo",
      category: "templates",
      tags: ["thesis", "dissertation", "phd"],
      homepage: "https://latexdo.org/store/extensions/latexdo.thesis/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        templates: [
          {
            id: "thesis-dissertation",
            name: "Thesis or Dissertation",
            summary:
              "Two-sided report with title page, front matter, contents, chapters, theorem environments and an appendix.",
            files: "main.tex",
            mainTex:
              "\\documentclass[11pt,a4paper,twoside,openright]{report}\n\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\usepackage{lmodern}\n\\usepackage[a4paper,inner=3cm,outer=2.5cm,top=2.5cm,bottom=2.5cm]{geometry}\n\\usepackage{amsmath,amssymb,amsthm}\n\\usepackage{graphicx}\n\\usepackage{booktabs}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage[nameinlink]{cleveref}\n\\usepackage{setspace}\n\\onehalfspacing\n\n\\newtheorem{theorem}{Theorem}[chapter]\n\\newtheorem{definition}[theorem]{Definition}\n\n\\title{Thesis Title}\n\\author{Your Name}\n\\date{Month Year}\n\n\\begin{document}\n\n\\begin{titlepage}\n  \\centering\n  \\vspace*{3cm}\n  {\\Huge\\bfseries Thesis Title\\par}\n  \\vspace{1.5cm}\n  {\\Large Your Name\\par}\n  \\vfill\n  A thesis submitted for the degree of\\\\\n  \\emph{Doctor of Philosophy}\\\\[1em]\n  Department, University\\\\\n  Month Year\n\\end{titlepage}\n\n\\pagenumbering{roman}\n\n\\chapter*{Abstract}\n\\addcontentsline{toc}{chapter}{Abstract}\nSummarise the question, the approach and the main findings of the thesis.\n\n\\chapter*{Acknowledgements}\n\\addcontentsline{toc}{chapter}{Acknowledgements}\nThank the people and funders who supported this work.\n\n\\tableofcontents\n\\listoffigures\n\\listoftables\n\n\\cleardoublepage\n\\pagenumbering{arabic}\n\n\\chapter{Introduction}\n\\label{ch:introduction}\nState the research questions and the structure of the thesis.\n\n\\section{Contributions}\n\\begin{enumerate}\n  \\item The first contribution, presented in \\cref{ch:background}.\n  \\item The second contribution.\n\\end{enumerate}\n\n\\chapter{Background}\n\\label{ch:background}\n\\begin{definition}\n  A precise definition used throughout the thesis.\n\\end{definition}\n\n\\chapter{Conclusion}\n\\label{ch:conclusion}\nAnswer the research questions and describe future work.\n\n\\appendix\n\\chapter{Additional Material}\nSupplementary proofs, tables and figures.\n\n\\end{document}\n",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.academic-cv",
      kind: "template",
      name: "Academic CV",
      version: "1.0.0",
      description:
        "A clean one-column academic CV with education, appointments, numbered publications, grants, teaching and service sections.",
      author: "LatexDo",
      category: "templates",
      tags: ["cv", "resume", "career"],
      homepage: "https://latexdo.org/store/extensions/latexdo.academic-cv/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        templates: [
          {
            id: "academic-cv",
            name: "Academic CV",
            summary:
              "One-column academic CV with ORCID link, dated entries and numbered publications.",
            files: "main.tex",
            mainTex:
              "\\documentclass[11pt,a4paper]{article}\n\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\usepackage{lmodern}\n\\usepackage[margin=2cm]{geometry}\n\\usepackage{enumitem}\n\\usepackage{titlesec}\n\\usepackage[hidelinks]{hyperref}\n\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}\n\\titleformat{\\section}{\\large\\bfseries}{}{0pt}{}[\\vspace{2pt}\\hrule]\n\\titlespacing*{\\section}{0pt}{14pt}{6pt}\n\\setlist[itemize]{leftmargin=1.2em,itemsep=2pt,topsep=2pt}\n\n% \\entry{dates}{title}{place}{details}\n\\newcommand{\\entry}[4]{%\n  \\textbf{#2} \\hfill #1\\\\\n  \\emph{#3}\\\\[-2pt]\n  \\ifx\\relax#4\\relax\\else{\\small #4}\\\\\\fi\n  \\vspace{4pt}}\n\n\\begin{document}\n\n{\\LARGE\\bfseries Your Name}\\\\[4pt]\nPosition, Department, University\\\\\n\\href{mailto:you@example.org}{you@example.org} \\quad\n\\href{https://orcid.org/0000-0000-0000-0000}{ORCID 0000-0000-0000-0000} \\quad\n\\href{https://example.org}{example.org}\n\n\\section{Research Interests}\nThree to five research areas, in one or two lines.\n\n\\section{Education}\n\\entry{2020--2024}{PhD in Computer Science}{University, City}{Thesis: Title of the Thesis. Advisor: Name.}\n\\entry{2018--2020}{MSc in Computer Science}{University, City}{}\n\n\\section{Appointments}\n\\entry{2024--present}{Postdoctoral Researcher}{Institute, City}{}\n\n\\section{Publications}\n\\begin{enumerate}[label={[\\arabic*]},leftmargin=2.2em]\n  \\item \\textbf{Your Name}, Coauthor. Paper title. \\emph{Venue}, 2024.\n  \\item Coauthor, \\textbf{Your Name}. Paper title. \\emph{Journal}, 2023.\n\\end{enumerate}\n\n\\section{Grants and Awards}\n\\begin{itemize}\n  \\item Award or grant name, funder, 2024.\n\\end{itemize}\n\n\\section{Teaching}\n\\begin{itemize}\n  \\item Course name (teaching assistant), University, 2022--2023.\n\\end{itemize}\n\n\\section{Service}\n\\begin{itemize}\n  \\item Reviewer for Venue A, Venue B.\n\\end{itemize}\n\n\\end{document}\n",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.research-poster",
      kind: "template",
      name: "Research Poster",
      version: "1.0.0",
      description:
        "An A0 portrait conference poster built with tikzposter: title banner, two columns of blocks, an equation and a results table.",
      author: "LatexDo",
      category: "templates",
      tags: ["poster", "conference", "a0"],
      homepage: "https://latexdo.org/store/extensions/latexdo.research-poster/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        templates: [
          {
            id: "research-poster",
            name: "Research Poster (A0)",
            summary:
              "tikzposter A0 portrait poster with title banner, two columns of blocks, an equation and a results table.",
            files: "main.tex",
            mainTex:
              "\\documentclass[25pt,a0paper,portrait]{tikzposter}\n\n\\usepackage{amsmath}\n\\usepackage{booktabs}\n\n\\title{Poster Title: The Main Finding in One Line}\n\\author{First Author, Second Author}\n\\institute{Department, University}\n\n\\usetheme{Simple}\n\\usecolorstyle{Default}\n\n\\begin{document}\n\n\\maketitle\n\n\\begin{columns}\n  \\column{0.5}\n  \\block{Motivation}{\n    Why the problem matters, in two or three sentences a visitor can read from two metres away.\n  }\n  \\block{Approach}{\n    The key idea:\n    \\[\n      \\hat{\\theta} = \\arg\\min_{\\theta} \\sum_{i} \\ell\\bigl(f_\\theta(x_i), y_i\\bigr)\n    \\]\n  }\n\n  \\column{0.5}\n  \\block{Results}{\n    \\begin{tabular}{lcc}\n      \\toprule\n      Method & Accuracy & Time \\\\\n      \\midrule\n      Baseline & 81.2 & 12.4 \\\\\n      Ours & \\textbf{86.9} & \\textbf{9.1} \\\\\n      \\bottomrule\n    \\end{tabular}\n  }\n  \\block{Take-home message}{\n    One sentence the visitor should remember.\n  }\n\\end{columns}\n\n\\block{References and contact}{\n  Paper link, code link, and an email address.\n}\n\n\\end{document}\n",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.plots",
      kind: "extension",
      name: "Plots and Figures",
      version: "1.0.0",
      description:
        "pgfplots line, bar and scatter charts, grouped plots and subfigures that match the paper's fonts, with no image export step.",
      author: "LatexDo",
      category: "graphics",
      tags: ["pgfplots", "charts", "figures"],
      homepage: "https://latexdo.org/store/extensions/latexdo.plots/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "lineplot",
            detail: "Line plot (pgfplots)",
            documentation:
              "A line chart from inline coordinates with axis labels and a legend. Needs pgfplots.",
            insertText:
              "\\\\begin{figure\\}[t]\n  \\\\centering\n  \\\\begin{tikzpicture\\}\n    \\\\begin{axis\\}[\n      width=\\\\linewidth, height=5cm,\n      xlabel={${1:Epoch}\\}, ylabel={${2:Accuracy (\\\\%)}\\},\n      legend pos=south east, grid=major,\n    ]\n      \\\\addplot+[mark=*] coordinates {(1,62) (2,71) (3,77) (4,80)\\};\n      \\\\addlegendentry{${3:Ours}\\}\n      \\\\addplot+[mark=square*] coordinates {(1,60) (2,66) (3,70) (4,72)\\};\n      \\\\addlegendentry{${4:Baseline}\\}\n    \\\\end{axis\\}\n  \\\\end{tikzpicture\\}\n  \\\\caption{${5:Caption.}\\}\n  \\\\label{fig:${6:plot}\\}\n\\\\end{figure\\}",
          },
          {
            label: "barchart",
            detail: "Grouped bar chart (pgfplots)",
            documentation:
              "Grouped bars per category with values on top. Needs pgfplots.",
            insertText:
              "\\\\begin{figure\\}[t]\n  \\\\centering\n  \\\\begin{tikzpicture\\}\n    \\\\begin{axis\\}[\n      ybar, bar width=10pt, width=\\\\linewidth, height=5cm,\n      symbolic x coords={${1:A},${2:B},${3:C}\\}, xtick=data,\n      ylabel={${4:Score}\\}, nodes near coords, ymin=0,\n      legend style={at={(0.5,1.02)\\}, anchor=south, legend columns=-1\\},\n    ]\n      \\\\addplot coordinates {(${1:A},72) (${2:B},64) (${3:C},81)\\};\n      \\\\addplot coordinates {(${1:A},68) (${2:B},59) (${3:C},75)\\};\n      \\\\legend{${5:Ours},${6:Baseline}\\}\n    \\\\end{axis\\}\n  \\\\end{tikzpicture\\}\n  \\\\caption{${7:Caption.}\\}\n  \\\\label{fig:${8:bars}\\}\n\\\\end{figure\\}",
          },
          {
            label: "scatterplot",
            detail: "Scatter plot with error bars",
            documentation: "Points with symmetric y error bars. Needs pgfplots.",
            insertText:
              "\\\\begin{tikzpicture\\}\n  \\\\begin{axis\\}[xlabel={${1:x}\\}, ylabel={${2:y}\\}, width=0.9\\\\linewidth]\n    \\\\addplot+[only marks, error bars/.cd, y dir=both, y explicit]\n      coordinates {(1,2.1) +- (0,0.3) (2,3.9) +- (0,0.4) (3,6.2) +- (0,0.5)\\};\n  \\\\end{axis\\}\n\\\\end{tikzpicture\\}",
          },
          {
            label: "groupplot",
            detail: "Two plots side by side",
            documentation:
              "Two axes sharing a style with groupplots. Needs the pgfplots groupplots library.",
            insertText:
              "\\\\begin{tikzpicture\\}\n  \\\\begin{groupplot\\}[group style={group size=2 by 1, horizontal sep=1.5cm\\}, width=0.48\\\\linewidth, height=4.5cm]\n    \\\\nextgroupplot[title={${1:Left}\\}]\n    \\\\addplot coordinates {(0,0) (1,1) (2,4)\\};\n    \\\\nextgroupplot[title={${2:Right}\\}]\n    \\\\addplot coordinates {(0,0) (1,2) (2,3)\\};\n  \\\\end{groupplot\\}\n\\\\end{tikzpicture\\}",
          },
          {
            label: "subfigures",
            detail: "Two-panel figure",
            documentation:
              "Two images side by side with sub-captions. Needs subcaption and graphicx.",
            insertText:
              "\\\\begin{figure\\}[t]\n  \\\\centering\n  \\\\begin{subfigure\\}[b]{0.48\\\\linewidth\\}\n    \\\\centering\n    \\\\includegraphics[width=\\\\linewidth]{${1:example-image-a}\\}\n    \\\\caption{${2:Left panel.}\\}\n    \\\\label{fig:${3:left}\\}\n  \\\\end{subfigure\\}\\\\hfill\n  \\\\begin{subfigure\\}[b]{0.48\\\\linewidth\\}\n    \\\\centering\n    \\\\includegraphics[width=\\\\linewidth]{${4:example-image-b}\\}\n    \\\\caption{${5:Right panel.}\\}\n    \\\\label{fig:${6:right}\\}\n  \\\\end{subfigure\\}\n  \\\\caption{${7:Overall caption.}\\}\n  \\\\label{fig:${8:panels}\\}\n\\\\end{figure\\}",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.publication-tables",
      kind: "extension",
      name: "Publication Tables",
      version: "1.0.0",
      description:
        "Journal-quality tables: booktabs results with the best value in bold, table notes, merged rows, aligned decimals and long tables.",
      author: "LatexDo",
      category: "graphics",
      tags: ["tables", "booktabs", "siunitx"],
      homepage: "https://latexdo.org/store/extensions/latexdo.publication-tables/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "resultstable",
            detail: "Results table, best in bold",
            documentation: "A booktabs comparison table. Needs booktabs.",
            insertText:
              "\\\\begin{table\\}[t]\n  \\\\centering\n  \\\\caption{${1:Results on the test set. Best in bold.}\\}\n  \\\\label{tab:${2:results}\\}\n  \\\\begin{tabular\\}{lccc\\}\n    \\\\toprule\n    Method & ${3:Precision} & ${4:Recall} & ${5:F1} \\\\\\\\\n    \\\\midrule\n    Baseline & 0.71 & 0.65 & 0.68 \\\\\\\\\n    Ours & \\\\textbf{0.79\\} & \\\\textbf{0.74\\} & \\\\textbf{0.76\\} \\\\\\\\\n    \\\\bottomrule\n  \\\\end{tabular\\}\n\\\\end{table\\}",
          },
          {
            label: "notestable",
            detail: "Table with notes",
            documentation:
              "A table with footnote-style notes underneath. Needs threeparttable and booktabs.",
            insertText:
              "\\\\begin{table\\}[t]\n  \\\\centering\n  \\\\begin{threeparttable\\}\n    \\\\caption{${1:Caption.}\\}\n    \\\\label{tab:${2:notes}\\}\n    \\\\begin{tabular\\}{lcc\\}\n      \\\\toprule\n      ${3:Setting} & ${4:Value}\\\\tnote{a\\} & ${5:Error} \\\\\\\\\n      \\\\midrule\n      A & 1.0 & 0.1 \\\\\\\\\n      B & 2.0 & 0.2 \\\\\\\\\n      \\\\bottomrule\n    \\\\end{tabular\\}\n    \\\\begin{tablenotes\\}\\\\footnotesize\n      \\\\item[a] ${6:Explain the marked value.}\n    \\\\end{tablenotes\\}\n  \\\\end{threeparttable\\}\n\\\\end{table\\}",
          },
          {
            label: "multirowtable",
            detail: "Table with merged rows",
            documentation:
              "Rows grouped by a merged first column. Needs multirow and booktabs.",
            insertText:
              "\\\\begin{tabular\\}{llc\\}\n  \\\\toprule\n  ${1:Dataset} & ${2:Method} & ${3:Score} \\\\\\\\\n  \\\\midrule\n  \\\\multirow{2\\}{*\\}{${4:First}\\} & Baseline & 70.1 \\\\\\\\\n                           & Ours & 74.3 \\\\\\\\\n  \\\\midrule\n  \\\\multirow{2\\}{*\\}{${5:Second}\\} & Baseline & 61.0 \\\\\\\\\n                            & Ours & 66.8 \\\\\\\\\n  \\\\bottomrule\n\\\\end{tabular\\}",
          },
          {
            label: "decimaltable",
            detail: "Numbers aligned on the decimal point",
            documentation:
              "siunitx S columns keep numbers aligned. Needs siunitx and booktabs.",
            insertText:
              "\\\\begin{tabular\\}{l S[table-format=2.2] S[table-format=3.1]\\}\n  \\\\toprule\n  {${1:Item}\\} & {${2:Mean}\\} & {${3:Total}\\} \\\\\\\\\n  \\\\midrule\n  A & 3.14 & 12.5 \\\\\\\\\n  B & 12.06 & 101.0 \\\\\\\\\n  \\\\bottomrule\n\\\\end{tabular\\}",
          },
          {
            label: "longtable",
            detail: "Table across pages",
            documentation:
              "A long table that repeats its header on every page. Needs longtable and booktabs.",
            insertText:
              "\\\\begin{longtable\\}{lp{0.6\\\\linewidth\\}\\}\n  \\\\caption{${1:Caption.}\\}\\\\label{tab:${2:long}\\} \\\\\\\\\n  \\\\toprule\n  ${3:Term} & ${4:Definition} \\\\\\\\\n  \\\\midrule\n  \\\\endfirsthead\n  \\\\toprule\n  ${3:Term} & ${4:Definition} \\\\\\\\\n  \\\\midrule\n  \\\\endhead\n  \\\\bottomrule\n  \\\\endfoot\n  ${5:Entry} & ${6:Description.} \\\\\\\\\n\\\\end{longtable\\}",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.algorithms",
      kind: "extension",
      name: "Algorithms",
      version: "1.0.0",
      description:
        "Pseudocode for computer science papers: numbered algorithms with inputs and outputs, procedures, loops and complexity comments.",
      author: "LatexDo",
      category: "writing",
      tags: ["algorithms", "pseudocode", "computer-science"],
      homepage: "https://latexdo.org/store/extensions/latexdo.algorithms/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "algorithm",
            detail: "Numbered algorithm",
            documentation:
              "An algorithm float with inputs, outputs and a loop. Needs algorithm and algpseudocode.",
            insertText:
              "\\\\begin{algorithm\\}[t]\n  \\\\caption{${1:Algorithm name}\\}\n  \\\\label{alg:${2:main}\\}\n  \\\\begin{algorithmic\\}[1]\n    \\\\Require ${3:input \\$x\\$}\n    \\\\Ensure ${4:output \\$y\\$}\n    \\\\State \\$y \\\\gets 0\\$\n    \\\\For{\\$i \\\\gets 1\\$ \\\\textbf{to\\} \\$n\\$\\}\n      \\\\State \\$y \\\\gets y + x_i\\$ \\\\Comment{${5:accumulate}\\}\n    \\\\EndFor\n    \\\\State \\\\Return \\$y\\$\n  \\\\end{algorithmic\\}\n\\\\end{algorithm\\}",
          },
          {
            label: "procedure",
            detail: "Procedure with a while loop",
            documentation:
              "A named procedure with a condition and a loop. Needs algpseudocode.",
            insertText:
              "\\\\begin{algorithmic\\}[1]\n  \\\\Procedure{${1:Search}\\}{\\$${2:A}, ${3:t}\\$\\}\n    \\\\State \\$lo \\\\gets 1\\$, \\$hi \\\\gets n\\$\n    \\\\While{\\$lo \\\\le hi\\$\\}\n      \\\\State \\$m \\\\gets \\\\lfloor (lo + hi)/2 \\\\rfloor\\$\n      \\\\If{\\$A[m] = t\\$\\}\n        \\\\State \\\\Return \\$m\\$\n      \\\\ElsIf{\\$A[m] < t\\$\\}\n        \\\\State \\$lo \\\\gets m + 1\\$\n      \\\\Else\n        \\\\State \\$hi \\\\gets m - 1\\$\n      \\\\EndIf\n    \\\\EndWhile\n    \\\\State \\\\Return \\\\textsc{None\\}\n  \\\\EndProcedure\n\\\\end{algorithmic\\}",
          },
          {
            label: "algorithmfunction",
            detail: "Function call in pseudocode",
            documentation:
              "Calls a named routine inside a state line. Needs algpseudocode.",
            insertText:
              "\\\\State \\$${1:r} \\\\gets \\\\Call{${2:Routine}\\}{${3:arguments}\\}\\$",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.math-writing",
      kind: "extension",
      name: "Math Writing",
      version: "1.0.0",
      description:
        "Theorem, lemma, proof and definition environments, aligned derivations, cases and operators such as argmin, set up correctly.",
      author: "LatexDo",
      category: "writing",
      tags: ["math", "theorems", "proofs"],
      homepage: "https://latexdo.org/store/extensions/latexdo.math-writing/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "theoremsetup",
            detail: "Theorem environments (preamble)",
            documentation:
              "Defines theorem, lemma, corollary and definition, plus argmin and argmax. Put it in the preamble; needs amsthm and amsmath.",
            insertText:
              "\\\\usepackage{amsmath,amssymb,amsthm,mathtools\\}\n\\\\newtheorem{theorem\\}{Theorem\\}\n\\\\newtheorem{lemma\\}[theorem]{Lemma\\}\n\\\\newtheorem{corollary\\}[theorem]{Corollary\\}\n\\\\theoremstyle{definition\\}\n\\\\newtheorem{definition\\}[theorem]{Definition\\}\n\\\\DeclareMathOperator*{\\\\argmin\\}{arg\\\\,min\\}\n\\\\DeclareMathOperator*{\\\\argmax\\}{arg\\\\,max\\}",
          },
          {
            label: "theorem",
            detail: "Theorem",
            documentation: "A labelled theorem.",
            insertText:
              "\\\\begin{theorem\\}\\\\label{thm:${1:main}\\}\n  ${0:Statement.}\n\\\\end{theorem\\}",
          },
          {
            label: "lemma",
            detail: "Lemma",
            documentation: "A labelled lemma.",
            insertText:
              "\\\\begin{lemma\\}\\\\label{lem:${1:key}\\}\n  ${0:Statement.}\n\\\\end{lemma\\}",
          },
          {
            label: "definition",
            detail: "Definition",
            documentation: "A labelled definition.",
            insertText:
              "\\\\begin{definition\\}[${1:Name}]\\\\label{def:${2:name}\\}\n  ${0:Definition.}\n\\\\end{definition\\}",
          },
          {
            label: "proof",
            detail: "Proof",
            documentation: "A proof that ends with the QED box.",
            insertText: "\\\\begin{proof\\}\n  ${0:Argument.}\n\\\\end{proof\\}",
          },
          {
            label: "derivation",
            detail: "Aligned derivation",
            documentation: "A multi-line derivation aligned on equals signs.",
            insertText:
              "\\\\begin{align\\}\n  ${1:f(x)} &= ${2:(x + 1)^2} \\\\\\\\\n           &= ${3:x^2 + 2x + 1}. \\\\label{eq:${4:derivation}\\}\n\\\\end{align\\}",
          },
          {
            label: "cases",
            detail: "Piecewise definition",
            documentation: "A function defined by cases.",
            insertText:
              "\\\\[\n  ${1:f(x)} =\n  \\\\begin{cases\\}\n    ${2:x} & \\\\text{if \\} ${3:x \\\\ge 0}, \\\\\\\\\n    ${4:-x} & \\\\text{otherwise\\}.\n  \\\\end{cases\\}\n\\\\]",
          },
          {
            label: "optimisation",
            detail: "Optimisation problem",
            documentation: "An argmin objective with a constraint.",
            insertText:
              "\\\\[\n  \\\\hat{\\\\theta\\} = \\\\argmin_{\\\\theta \\\\in \\\\Theta\\} \\\\; ${1:\\\\sum_{i=1\\}^{n\\} \\\\ell(f_\\\\theta(x_i), y_i)} \\\\quad \\\\text{s.t. \\} ${2:\\\\lVert \\\\theta \\\\rVert \\\\le C}\n\\\\]",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.units-chemistry",
      kind: "extension",
      name: "Units and Chemistry",
      version: "1.0.0",
      description:
        "Correct numbers, units and ranges with siunitx, chemical formulas and reactions with mhchem, and skeletal structures with chemfig.",
      author: "LatexDo",
      category: "writing",
      tags: ["siunitx", "chemistry", "units"],
      homepage: "https://latexdo.org/store/extensions/latexdo.units-chemistry/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "quantity",
            detail: "Number with unit",
            documentation:
              "Typesets a value and its unit with correct spacing. Needs siunitx.",
            insertText:
              "\\\\qty{${1:9.81}\\}{${2:\\\\metre\\\\per\\\\second\\\\squared}\\}",
          },
          {
            label: "number",
            detail: "Formatted number",
            documentation: "Groups digits and formats exponents. Needs siunitx.",
            insertText: "\\\\num{${1:1.2e-3}\\}",
          },
          {
            label: "quantityrange",
            detail: "Range with unit",
            documentation: "A range such as 10 to 20 °C. Needs siunitx.",
            insertText: "\\\\qtyrange{${1:10}\\}{${2:20}\\}{${3:\\\\degreeCelsius}\\}",
          },
          {
            label: "chemformula",
            detail: "Chemical formula",
            documentation: "Formulas and ions with mhchem.",
            insertText: "\\\\ce{${1:H2SO4}\\}",
          },
          {
            label: "reaction",
            detail: "Chemical reaction",
            documentation: "A reaction with an arrow and conditions. Needs mhchem.",
            insertText: "\\\\ce{${1:2H2 + O2} ->[${2:catalyst}] ${3:2H2O}\\}",
          },
          {
            label: "structure",
            detail: "Skeletal structure",
            documentation: "A chemfig structural formula (ethanol shown).",
            insertText: "\\\\chemfig{${1:H_3C-CH_2-OH}\\}",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.code-listings",
      kind: "extension",
      name: "Code Listings",
      version: "1.0.0",
      description:
        "Readable source code in papers: a listings style with line numbers and highlighting, listing floats, inline code and file input.",
      author: "LatexDo",
      category: "writing",
      tags: ["code", "listings", "software"],
      homepage: "https://latexdo.org/store/extensions/latexdo.code-listings/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "listingsetup",
            detail: "Listings style (preamble)",
            documentation:
              "A clean code style with line numbers and colours. Put it in the preamble; needs listings and xcolor.",
            insertText:
              "\\\\usepackage{xcolor\\}\n\\\\usepackage{listings\\}\n\\\\lstdefinestyle{paper\\}{\n  basicstyle=\\\\ttfamily\\\\small, numbers=left, numberstyle=\\\\tiny\\\\color{gray\\},\n  keywordstyle=\\\\color{blue!70!black\\}\\\\bfseries, commentstyle=\\\\color{green!40!black\\}\\\\itshape,\n  stringstyle=\\\\color{red!60!black\\}, breaklines=true, frame=tb, captionpos=b,\n  showstringspaces=false,\n\\}\n\\\\lstset{style=paper\\}",
          },
          {
            label: "codelisting",
            detail: "Code listing",
            documentation: "A captioned, labelled code block.",
            insertText:
              "\\\\begin{lstlisting\\}[language=${1:Python}, caption={${2:Caption.}\\}, label={lst:${3:code}\\}]\n${4:def mean(xs):\n    return sum(xs) / len(xs)}\n\\\\end{lstlisting\\}",
          },
          {
            label: "inlinecode",
            detail: "Inline code",
            documentation: "Code inside a sentence.",
            insertText: "\\\\lstinline|${1:x = f(y)}|",
          },
          {
            label: "codefile",
            detail: "Code from a file",
            documentation: "Includes a source file from the project.",
            insertText:
              "\\\\lstinputlisting[language=${1:Python}, caption={${2:Caption.}\\}]{${3:code/example.py}\\}",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.paper-statements",
      kind: "extension",
      name: "Paper Statements",
      version: "1.0.0",
      description:
        "The statements journals now require: data and code availability, author contributions (CRediT), funding, conflicts and ethics, plus a reproducibility checklist.",
      author: "LatexDo",
      category: "checking",
      tags: ["reproducibility", "open-science", "submission"],
      homepage: "https://latexdo.org/store/extensions/latexdo.paper-statements/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "dataavailability",
            detail: "Data availability statement",
            documentation:
              "States where the data can be found and under which licence.",
            insertText:
              "\\\\section*{Data Availability\\}\nThe data supporting this study are openly available in ${1:Repository} at \\\\url{${2:https://doi.org/...}\\} under the ${3:CC BY 4.0} licence.",
          },
          {
            label: "codeavailability",
            detail: "Code availability statement",
            documentation: "Points to the archived code release.",
            insertText:
              "\\\\section*{Code Availability\\}\nThe code used in this study is available at \\\\url{${1:https://github.com/...}\\} and archived at \\\\url{${2:https://doi.org/...}\\} (version ${3:1.0}).",
          },
          {
            label: "credit",
            detail: "Author contributions (CRediT)",
            documentation: "Contributions using the CRediT taxonomy roles.",
            insertText:
              "\\\\section*{Author Contributions\\}\n\\\\textbf{${1:First Author}\\}: Conceptualization, Methodology, Software, Writing -- original draft.\n\\\\textbf{${2:Second Author}\\}: Supervision, Writing -- review \\\\& editing, Funding acquisition.",
          },
          {
            label: "funding",
            detail: "Funding statement",
            documentation: "Grant numbers and funders.",
            insertText:
              "\\\\section*{Funding\\}\nThis work was supported by ${1:Funder} under grant ${2:number}. The funder had no role in study design, data collection, analysis or the decision to publish.",
          },
          {
            label: "conflicts",
            detail: "Competing interests",
            documentation: "Declares (no) competing interests.",
            insertText:
              "\\\\section*{Competing Interests\\}\nThe authors declare ${1:no competing interests}.",
          },
          {
            label: "ethics",
            detail: "Ethics statement",
            documentation: "Approval and consent for human or animal studies.",
            insertText:
              "\\\\section*{Ethics Statement\\}\nThis study was approved by ${1:the ethics committee of University} (approval ${2:number}). ${3:All participants gave informed consent.}",
          },
          {
            label: "artifactchecklist",
            detail: "Reproducibility checklist",
            documentation: "A short paragraph covering code, data, seeds and hardware.",
            insertText:
              "\\\\paragraph{Reproducibility.\\}\nCode and data are available at ${1:URL}. Experiments use random seeds ${2:0--4} and ran on ${3:hardware}; each run took about ${4:time}. Hyperparameters are listed in ${5:Appendix~\\\\ref{app:hyper\\}}.",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.review-revision",
      kind: "extension",
      name: "Review and Revision",
      version: "1.0.0",
      description:
        "Tools for co-writing and revising: visible added, deleted and replaced text, to-do notes, placeholder figures and reviewer response blocks.",
      author: "LatexDo",
      category: "workflow",
      tags: ["revision", "review", "collaboration"],
      homepage: "https://latexdo.org/store/extensions/latexdo.review-revision/",
      repository: "https://github.com/latexdo/latexdo.org",
      contributes: {
        snippets: [
          {
            label: "changessetup",
            detail: "Change tracking (preamble)",
            documentation:
              "Marks edits in colour; use the final option to hide them for submission. Needs changes.",
            insertText:
              "\\\\usepackage[${1:draft}]{changes\\}\n\\\\definechangesauthor[name={${2:Reviewer 1}\\}, color=${3:blue}]{${4:R1}\\}",
          },
          {
            label: "added",
            detail: "Mark added text",
            documentation: "Shows new text in colour while in draft mode.",
            insertText: "\\\\added{${1:new text}\\}",
          },
          {
            label: "deleted",
            detail: "Mark deleted text",
            documentation: "Shows removed text struck through.",
            insertText: "\\\\deleted{${1:old text}\\}",
          },
          {
            label: "replaced",
            detail: "Mark replaced text",
            documentation: "Shows the new and old wording.",
            insertText: "\\\\replaced{${1:new text}\\}{${2:old text}\\}",
          },
          {
            label: "todo",
            detail: "To-do note",
            documentation: "A margin note for co-authors. Needs todonotes.",
            insertText: "\\\\todo{${1:Check this claim.}\\}",
          },
          {
            label: "inlinetodo",
            detail: "Inline to-do",
            documentation: "A to-do inside the text. Needs todonotes.",
            insertText: "\\\\todo[inline]{${1:Add the missing experiment.}\\}",
          },
          {
            label: "missingfigure",
            detail: "Placeholder figure",
            documentation:
              "A box that marks a figure still to be made. Needs todonotes.",
            insertText: "\\\\missingfigure{${1:Plot of accuracy versus epochs.}\\}",
          },
          {
            label: "reviewresponse",
            detail: "Reviewer response block",
            documentation: "A reviewer comment followed by the response.",
            insertText:
              "\\\\paragraph{Reviewer ${1:1}, Comment ${2:1}.\\}\n\\\\emph{${3:Reviewer comment.}\\}\n\n\\\\paragraph{Response.\\}\n${0:Thank you for the helpful comment. We revised the manuscript to clarify this point.}",
          },
          {
            label: "revisionnote",
            detail: "Revision note",
            documentation: "A short summary of a change.",
            insertText:
              "\\\\paragraph{Change made.\\}\nWe updated ${1:Section~\\\\ref{sec:method\\}} to ${0:describe the revision}.",
          },
        ],
      },
    },
  ],
};

export function categoryLabel(category: ExtensionCategory): string {
  switch (category) {
    case "bibliography":
      return "Bibliography";
    case "checking":
      return "Checking";
    case "graphics":
      return "Graphics";
    case "templates":
      return "Templates";
    case "workflow":
      return "Workflow";
    case "writing":
    default:
      return "Writing";
  }
}

export function contributionSummary(extension: LatexDoExtensionManifest): string[] {
  const featureCount = Object.keys(extension.contributes.featureFlags ?? {}).length;
  const snippetCount = extension.contributes.snippets?.length ?? 0;
  const templateCount = extension.contributes.templates?.length ?? 0;
  return [
    featureCount
      ? `${featureCount} feature toggle${featureCount === 1 ? "" : "s"}`
      : "",
    snippetCount ? `${snippetCount} snippet${snippetCount === 1 ? "" : "s"}` : "",
    templateCount ? `${templateCount} template${templateCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
}

export function validateExtensionCatalog(
  value: unknown,
): LatexDoExtensionCatalog | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schemaVersion !== 1 ||
    value.product !== "LatexDo" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.extensions)
  ) {
    return null;
  }

  const seen = new Set<string>();
  const extensions = value.extensions
    .map(normalizeExtensionManifest)
    .filter((extension): extension is LatexDoExtensionManifest => {
      if (!extension || seen.has(extension.id)) {
        return false;
      }
      seen.add(extension.id);
      return true;
    });

  return {
    schemaVersion: 1,
    product: "LatexDo",
    updatedAt: value.updatedAt,
    extensions,
  };
}

export async function fetchExtensionCatalog(
  catalogUrl = extensionStoreCatalogUrl,
  loadCatalogJson: ExtensionCatalogJsonLoader = defaultExtensionCatalogJsonLoader,
): Promise<ExtensionCatalogLoadResult> {
  try {
    const remoteCatalog = validateExtensionCatalog(await loadCatalogJson(catalogUrl));
    if (!remoteCatalog) {
      throw new Error("Store catalog is not a valid LatexDo extension catalog.");
    }

    return {
      catalog: mergeCatalogs(remoteCatalog),
      source: "remote",
    };
  } catch (error) {
    return {
      catalog: fallbackExtensionCatalog,
      source: "fallback",
      error:
        error instanceof Error
          ? error.message
          : "Could not load the LatexDo extension catalog.",
    };
  }
}

async function defaultExtensionCatalogJsonLoader(catalogUrl: string): Promise<unknown> {
  if (
    catalogUrl === extensionStoreCatalogUrl &&
    typeof window !== "undefined" &&
    typeof window.latexdo?.fetchExtensionCatalog === "function"
  ) {
    return window.latexdo.fetchExtensionCatalog();
  }

  return fetchExtensionCatalogJson(catalogUrl);
}

async function fetchExtensionCatalogJson(catalogUrl: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(catalogUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Store catalog returned HTTP ${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    window.clearTimeout(timeout);
  }
}

function mergeCatalogs(
  remoteCatalog: LatexDoExtensionCatalog,
): LatexDoExtensionCatalog {
  const extensionsById = new Map<string, LatexDoExtensionManifest>();

  for (const extension of fallbackExtensionCatalog.extensions) {
    extensionsById.set(extension.id, extension);
  }
  for (const extension of remoteCatalog.extensions) {
    extensionsById.set(extension.id, extension);
  }

  return {
    ...remoteCatalog,
    extensions: [...extensionsById.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

function normalizeExtensionManifest(value: unknown): LatexDoExtensionManifest | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schemaVersion !== 1 ||
    !isBoundedString(value.id, 3, 80) ||
    !extensionIdPattern.test(value.id) ||
    !isBoundedString(value.name, 2, 80) ||
    !isBoundedString(value.version, 1, 40) ||
    !extensionVersionPattern.test(value.version) ||
    !isBoundedString(value.description, 12, 260) ||
    !isBoundedString(value.author, 2, 80) ||
    !extensionCategories.includes(value.category as ExtensionCategory) ||
    !Array.isArray(value.tags) ||
    !isRecord(value.contributes)
  ) {
    return null;
  }

  const tags = value.tags
    .filter((tag): tag is string => isBoundedString(tag, 1, 28))
    .slice(0, 8);
  const kind: LatexDoExtensionKind =
    value.kind === "template" ? "template" : "extension";
  const homepage = optionalHttpsUrl(value.homepage);
  const repository = optionalHttpsUrl(value.repository);
  const screenshots = normalizeScreenshots(value.screenshots);
  const featureFlags = normalizeFeatureFlags(value.contributes.featureFlags);
  const snippets = normalizeSnippets(value.contributes.snippets);
  const templates = normalizeTemplates(value.contributes.templates);
  const contributes: LatexDoExtensionContributions = {};

  if (Object.keys(featureFlags).length) {
    contributes.featureFlags = featureFlags;
  }
  if (snippets.length) {
    contributes.snippets = snippets;
  }
  if (templates.length) {
    contributes.templates = templates;
  }

  if (!contributes.featureFlags && !contributes.snippets && !contributes.templates) {
    return null;
  }

  return {
    schemaVersion: 1,
    id: value.id.trim(),
    kind,
    name: value.name.trim(),
    version: value.version.trim(),
    description: value.description.trim(),
    author: value.author.trim(),
    category: value.category as ExtensionCategory,
    tags,
    ...(homepage ? { homepage } : {}),
    ...(repository ? { repository } : {}),
    ...(screenshots.length ? { screenshots } : {}),
    contributes,
  };
}

// The app's content security policy only loads images from latexdo.org.
const screenshotHosts = new Set(["latexdo.org", "www.latexdo.org"]);

function normalizeScreenshots(value: unknown): ExtensionScreenshot[] {
  if (!Array.isArray(value)) return [];
  const screenshots: ExtensionScreenshot[] = [];
  for (const item of value.slice(0, 6)) {
    if (!isRecord(item)) continue;
    const url = optionalHttpsUrl(item.url);
    if (!url || !screenshotHosts.has(new URL(url).hostname)) continue;
    const caption = isBoundedString(item.caption, 1, 140)
      ? item.caption.trim()
      : undefined;
    screenshots.push(caption ? { url, caption } : { url });
  }
  return screenshots;
}

function normalizeFeatureFlags(
  value: unknown,
): Partial<Record<ExtensionFeatureFlag, boolean>> {
  if (!isRecord(value)) {
    return {};
  }

  const flags: Partial<Record<ExtensionFeatureFlag, boolean>> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (extensionFeatureFlags.has(key as ExtensionFeatureFlag)) {
      flags[key as ExtensionFeatureFlag] = enabled === true;
    }
  }
  return flags;
}

function normalizeSnippets(value: unknown): LatexDoExtensionSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((snippet): LatexDoExtensionSnippet | null => {
      if (
        !isRecord(snippet) ||
        !isBoundedString(snippet.label, 2, 48) ||
        !isBoundedString(snippet.insertText, 1, 4000)
      ) {
        return null;
      }

      const detail = isBoundedString(snippet.detail, 1, 120)
        ? snippet.detail.trim()
        : undefined;
      const documentation = isBoundedString(snippet.documentation, 1, 500)
        ? snippet.documentation.trim()
        : undefined;

      return {
        label: snippet.label.trim(),
        insertText: snippet.insertText,
        ...(detail ? { detail } : {}),
        ...(documentation ? { documentation } : {}),
      };
    })
    .filter((snippet): snippet is LatexDoExtensionSnippet => Boolean(snippet))
    .slice(0, 40);
}

function normalizeTemplates(value: unknown): LatexDoExtensionTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((template): LatexDoExtensionTemplate | null => {
      if (
        !isRecord(template) ||
        !isBoundedString(template.id, 2, 48) ||
        !/^[a-z0-9][a-z0-9.-]{1,47}$/.test(template.id) ||
        !isBoundedString(template.name, 2, 80) ||
        !isBoundedString(template.summary, 12, 220) ||
        !isBoundedString(template.files, 3, 120) ||
        !isBoundedString(template.mainTex, 20, 12000)
      ) {
        return null;
      }

      const bibTex = isBoundedString(template.bibTex, 1, 8000)
        ? template.bibTex
        : undefined;

      return {
        id: template.id.trim(),
        name: template.name.trim(),
        summary: template.summary.trim(),
        files: template.files.trim(),
        mainTex: template.mainTex,
        ...(bibTex ? { bibTex } : {}),
      };
    })
    .filter((template): template is LatexDoExtensionTemplate => Boolean(template))
    .slice(0, 12);
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (!isBoundedString(value, 8, 300)) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minLength &&
    value.length <= maxLength
  );
}
