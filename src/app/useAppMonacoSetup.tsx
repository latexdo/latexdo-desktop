import {
  documentEnvironments,
  documentMacros,
  getLatexArgumentContext,
  latexDocumentClasses,
  latexEnvironments,
  latexEverydayCommands,
  latexPackages,
  macroSnippet,
  openEnvironmentAt,
  projectFileArgument,
  projectFileMatchesKind,
} from "../latex/argumentCompletion";
import { recentCitationKeys } from "../features/citations/citationAssistant";
import type { BeforeMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { citationKeysInText } from "../latex/citationAnalysis";
import {
  figureBytesToDataUrl,
  figureCanRenderInline,
  figurePreviewCandidatePaths,
  figurePreviewMimeType,
  parseIncludeGraphicsAtPosition,
} from "../figurePreview";
import {
  getLatexCommandCompletionRange,
  getLatexCompletionContext,
} from "../latex/completionContext";
import {
  citationCompletionDetail,
  citationCompletionFilterText,
  citationCompletionLabelDetail,
  citationCompletionMarkdown,
  citationCompletionSortText,
  citationCompletionTriggerCharacters,
  citationCompletionUsageDescription,
  rankedCitationCompletions,
} from "../latex/citationCompletion";
import { parseBibFile } from "../latex/parseBib";
import { citationKeyAtPosition } from "../latex/citationHover";
import {
  citationVerificationMarkdown,
  peekCachedVerification,
  verifyCitationCached,
} from "../features/citations/citationVerification";
import { SYMBOL_PALETTE } from "../components/mathSymbolPalette";
import {
  buildLatexFoldingRanges,
  findLatexDocumentLinks,
  latexCommandSnippets,
} from "../latex/editorFeatureSupport";
import { escapeHtml } from "../features/editor/html";
import {
  fileName,
  flattenEntries,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  completionRangeAtPosition,
  completionReplacementRangeAtPosition,
  isSafeIpcProjectId,
  isSafeIpcRelativePath,
  isTextDocument,
  prepareMonacoProviderDisposables,
  setMonaco,
  citationSearchShortcutLabel,
} from "./appShared";
import type { AppCtx07 } from "./appContext";

export function useAppMonacoSetup(ctx: AppCtx07) {
  const {
    activePathRef,
    citationCitedKeysRef,
    citationEntriesByKeyRef,
    citationEntriesRef,
    citationProjectFilesRef,
    documentsRef,
    editorRef,
    figurePreviewCacheRef,
    installedExtensionSnippetsRef,
    mathPreviewForegrounds,
    projectEntriesRef,
    projectIdRef,
    settingsRef,
  } = ctx;

  const configureMonaco: BeforeMount = (instance) => {
    setMonaco(instance);
    const providerDisposables = prepareMonacoProviderDisposables();

    if (!instance.languages.getLanguages().some(({ id }) => id === "latex")) {
      instance.languages.register({
        id: "latex",
        extensions: [".tex", ".sty", ".cls"],
      });
    }
    if (!instance.languages.getLanguages().some(({ id }) => id === "bibtex")) {
      instance.languages.register({ id: "bibtex", extensions: [".bib"] });
    }
    if (!instance.languages.getLanguages().some(({ id }) => id === "asymptote")) {
      instance.languages.register({ id: "asymptote", extensions: [".asy"] });
    }

    instance.languages.setMonarchTokensProvider("latex", {
      tokenizer: {
        root: [
          [/%.*$/, "comment"],
          [/\\(?:begin|end)(?=\{)/, "keyword.control"],
          [/\\[a-zA-Z@]+|\\./, "keyword"],
          [/\$[^$]*\$/, "string"],
          [/[{}[\]]/, "delimiter"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
        ],
      },
    });
    instance.languages.setLanguageConfiguration("latex", {
      comments: { lineComment: "%" },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: "$", close: "$" },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "$", close: "$" },
      ],
    });
    if (providerDisposables) {
      providerDisposables.push(
        instance.languages.registerFoldingRangeProvider("latex", {
          provideFoldingRanges: (model) =>
            buildLatexFoldingRanges(model.getValue()).map((range) => ({
              start: range.start,
              end: range.end,
              kind:
                range.kind === "comment"
                  ? instance.languages.FoldingRangeKind.Comment
                  : instance.languages.FoldingRangeKind.Region,
            })),
        }),
      );
      providerDisposables.push(
        instance.languages.registerLinkProvider("latex", {
          provideLinks: (model) => ({
            links: findLatexDocumentLinks(model.getValue()).map((link) => ({
              range: new instance.Range(
                link.startLine,
                link.startColumn,
                link.endLine,
                link.endColumn,
              ),
              url: link.url,
              tooltip: `Open ${link.url}`,
            })),
          }),
        }),
      );
    }
    instance.languages.setMonarchTokensProvider("asymptote", {
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [
            /\b(?:access|defaultpen|draw|fill|filldraw|label|pair|path|pen|real|size|string|surface|triple|unitsize)\b/,
            "keyword",
          ],
          [/"([^"\\]|\\.)*$/, "string.invalid"],
          [/"/, "string", "@string"],
          [/[{}[\]();,]/, "delimiter"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, "string", "@pop"],
        ],
      },
    });
    instance.languages.setLanguageConfiguration("asymptote", {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
      ],
    });
    if (providerDisposables) {
      providerDisposables.push(
        instance.languages.registerCompletionItemProvider("asymptote", {
          triggerCharacters: ["(", "."],
          provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };
            return {
              suggestions: [
                ["size", "size(${1:6cm});"],
                ["draw", "draw((${1:0,0})--(${2:1,1}), ${3:blue});"],
                ["fill", "fill(${1:unitcircle}, ${2:lightgray});"],
                ["label", 'label("${1:text}", (${2:0,0}), ${3:N});'],
                ["pair", "pair ${1:p} = (${2:0}, ${3:0});"],
                ["path", "path ${1:p} = (${2:0,0})--(${3:1,1});"],
              ].map(([label, insertText]) => ({
                label,
                kind: instance.languages.CompletionItemKind.Snippet,
                insertText,
                insertTextRules:
                  instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                detail: "Asymptote snippet",
              })),
            };
          },
        }),
      );
      providerDisposables.push(
        instance.languages.registerCompletionItemProvider("latex", {
          triggerCharacters: ["\\", ...citationCompletionTriggerCharacters],
          provideCompletionItems: async (model, position, _context, token) => {
            const requestVersion = model.getVersionId();
            const requestOffset = model.getOffsetAt(position);
            const requestIsCurrent = () => {
              const editor = editorRef.current;
              const currentPosition = editor?.getPosition();
              return (
                !token.isCancellationRequested &&
                !model.isDisposed() &&
                model.getVersionId() === requestVersion &&
                editor?.getModel() === model &&
                currentPosition !== null &&
                currentPosition !== undefined &&
                model.getOffsetAt(currentPosition) === requestOffset
              );
            };
            const lineContent = model.getLineContent(position.lineNumber);
            const argumentCompletion = getLatexCompletionContext(
              lineContent,
              position.column,
            );
            const commandCompletion = getLatexCommandCompletionRange(
              lineContent,
              position.column,
            );
            const completionRange = (completion: {
              rangeStartColumn: number;
              rangeEndColumn: number;
            }) => completionRangeAtPosition(model, position, completion);
            const currentProject = projectIdRef.current;
            const readCompletionFile = (relativePath: string) =>
              isSafeIpcProjectId(currentProject) &&
              isSafeIpcRelativePath(relativePath, [".tex", ".bib"])
                ? window.latexdo.readFile(currentProject, relativePath)
                : Promise.reject(new Error("Invalid completion file path."));

            // Check if we are inside \cite{...}
            if (argumentCompletion?.type === "citation") {
              if (!isSafeIpcProjectId(currentProject)) {
                return { suggestions: [] };
              }
              const range = completionReplacementRangeAtPosition(
                model,
                position,
                argumentCompletion,
              );
              const suggestions: Monaco.languages.CompletionItem[] = [];
              const allEntries = flattenEntries(projectEntriesRef.current);
              const citedKeys = new Set(citationCitedKeysRef.current);
              const openDocuments = new Map(
                documentsRef.current.map((document) => [
                  normalizeRelativePath(document.relativePath),
                  document.content,
                ]),
              );
              for (const document of documentsRef.current) {
                if (isTextDocument(document) && document.name.endsWith(".tex")) {
                  for (const key of citationKeysInText(document.content)) {
                    citedKeys.add(key);
                  }
                }
              }
              const bibFiles = allEntries.filter(
                (entry) =>
                  entry.type === "file" &&
                  entry.name.endsWith(".bib") &&
                  isSafeIpcRelativePath(entry.relativePath, [".bib"]),
              );
              const scannedBibFiles = citationProjectFilesRef.current.filter((file) =>
                file.path.endsWith(".bib"),
              );
              const bibliographyEntries = scannedBibFiles.length
                ? scannedBibFiles.flatMap((file) => {
                    const normalizedPath = normalizeRelativePath(file.path);
                    const content = openDocuments.get(normalizedPath) ?? file.content;
                    return parseBibFile(content, normalizedPath);
                  })
                : [...citationEntriesRef.current];

              if (!bibliographyEntries.length) {
                for (const bib of bibFiles) {
                  if (!requestIsCurrent()) {
                    return { suggestions: [] };
                  }
                  try {
                    const content =
                      openDocuments.get(normalizeRelativePath(bib.relativePath)) ??
                      (await readCompletionFile(bib.relativePath));
                    bibliographyEntries.push(
                      ...parseBibFile(content, bib.relativePath),
                    );
                  } catch {
                    // Ignore missing/unreadable bib files
                  }
                }
              }
              if (!requestIsCurrent()) {
                return { suggestions: [] };
              }
              // Citations used near the caret come first while nothing is typed.
              const recentKeys = recentCitationKeys(
                model.getValue(),
                model.getOffsetAt(position),
                [],
                5,
              );
              for (const entry of rankedCitationCompletions(
                bibliographyEntries,
                argumentCompletion.currentText,
              )) {
                const recentRank = recentKeys.indexOf(entry.key);
                const usage = citationCompletionUsageDescription(entry, { citedKeys });
                suggestions.push({
                  label: {
                    label: entry.key,
                    detail: citationCompletionLabelDetail(entry),
                    description:
                      recentRank >= 0
                        ? ["📌 recent", usage].filter(Boolean).join(" · ")
                        : usage,
                  },
                  kind: instance.languages.CompletionItemKind.Reference,
                  insertText: entry.key,
                  detail: citationCompletionDetail(entry, { citedKeys }),
                  documentation: {
                    value: citationCompletionMarkdown(entry, { citedKeys }),
                    isTrusted: true,
                  },
                  filterText: citationCompletionFilterText(
                    entry,
                    argumentCompletion.currentText,
                  ),
                  sortText:
                    recentRank >= 0 && !argumentCompletion.currentText
                      ? `!${recentRank}`
                      : citationCompletionSortText(
                          entry,
                          argumentCompletion.currentText,
                        ),
                  range,
                  command: {
                    id: "latexdo.citation.accepted",
                    title: "Continue after citation",
                  },
                });
              }
              // The last row opens the full picker: search, recent, suggested
              // and online references. A finished key needs no search row.
              const typedKeyIsComplete = bibliographyEntries.some(
                (entry) => entry.key === argumentCompletion.currentText,
              );
              if (!typedKeyIsComplete)
                suggestions.push({
                  label: {
                    label: "🔎 Search library, recent & online…",
                    description: citationSearchShortcutLabel,
                  },
                  kind: instance.languages.CompletionItemKind.Event,
                  insertText: argumentCompletion.currentText,
                  filterText: argumentCompletion.currentText,
                  sortText: "~~~",
                  range,
                  command: {
                    id: "latexdo.citation.openSearch",
                    title: "Search bibliography",
                  },
                });
              return { suggestions, incomplete: true };
            }

            // Check if we are inside \ref{...}
            if (argumentCompletion?.type === "reference") {
              if (!isSafeIpcProjectId(currentProject)) {
                return { suggestions: [] };
              }
              const range = completionRange(argumentCompletion);
              const suggestions: Monaco.languages.CompletionItem[] = [];
              const allEntries = flattenEntries(projectEntriesRef.current);
              const texFiles = allEntries.filter(
                (entry) =>
                  entry.type === "file" &&
                  entry.name.endsWith(".tex") &&
                  isSafeIpcRelativePath(entry.relativePath, [".tex"]),
              );

              const openDocs = new Map(
                documentsRef.current.map((d) => [d.path, d.content]),
              );

              for (const tex of texFiles) {
                if (!requestIsCurrent()) {
                  return { suggestions: [] };
                }
                try {
                  let content = openDocs.get(tex.path);
                  if (content === undefined) {
                    content = await readCompletionFile(tex.relativePath);
                  }
                  const regex = /\\label\s*{([^}]+)}/g;
                  let match;
                  while ((match = regex.exec(content)) !== null) {
                    const label = match[1].trim();
                    suggestions.push({
                      label,
                      kind: instance.languages.CompletionItemKind.Reference,
                      insertText: label,
                      detail: `Label from ${tex.name}`,
                      range,
                    });
                  }
                } catch (e) {
                  // Ignore missing/unreadable tex files
                }
              }
              if (!requestIsCurrent()) {
                return { suggestions: [] };
              }
              // Remove duplicates
              const unique = new Map();
              for (const s of suggestions) unique.set(s.label, s);
              return { suggestions: Array.from(unique.values()) };
            }

            // Environments, packages, classes and project files (#227, #234).
            const argumentContext = getLatexArgumentContext(
              lineContent,
              position.column,
            );
            if (argumentContext) {
              const { kind } = argumentContext;
              const closesBrace = argumentContext.rest.startsWith("}");
              const range = completionRange(argumentContext);
              const texSources = documentsRef.current
                .filter(
                  (document) =>
                    isTextDocument(document) && document.name.endsWith(".tex"),
                )
                .map((document) => document.content);
              const item = (
                label: string,
                detail: string,
                insertText = label,
                extra: Partial<Monaco.languages.CompletionItem> = {},
              ): Monaco.languages.CompletionItem => ({
                label,
                kind: instance.languages.CompletionItemKind.Value,
                insertText,
                detail,
                range,
                ...extra,
              });

              if (kind === "environment" || kind === "endEnvironment") {
                const known = new Map(latexEnvironments);
                for (const name of documentEnvironments(texSources)) {
                  if (!known.has(name)) known.set(name, "Used in this project");
                }
                if (kind === "endEnvironment") {
                  const open = openEnvironmentAt(
                    model.getValue(),
                    model.getOffsetAt(position),
                  );
                  return {
                    suggestions: [...known].map(([name, description]) =>
                      item(
                        name,
                        name === open ? `Closes \\begin{${name}}` : description,
                        name,
                        {
                          kind: instance.languages.CompletionItemKind.Module,
                          sortText: name === open ? "!" : name,
                          preselect: name === open,
                        },
                      ),
                    ),
                  };
                }
                // On an otherwise empty line, \begin{name} also writes the \end.
                const closeBlock = /^\}?\s*$/.test(argumentContext.rest);
                const blockRange = closesBrace
                  ? completionRange({
                      rangeStartColumn: argumentContext.rangeStartColumn,
                      rangeEndColumn: argumentContext.rangeEndColumn + 1,
                    })
                  : range;
                return {
                  suggestions: [...known].map(([name, description]) =>
                    item(
                      name,
                      description,
                      closeBlock ? `${name}}\n\t$0\n\\end{${name}}` : name,
                      {
                        kind: instance.languages.CompletionItemKind.Module,
                        range: closeBlock ? blockRange : range,
                        insertTextRules: closeBlock
                          ? instance.languages.CompletionItemInsertTextRule
                              .InsertAsSnippet
                          : undefined,
                      },
                    ),
                  ),
                };
              }
              if (kind === "package") {
                return {
                  suggestions: latexPackages.map(([name, description]) =>
                    item(name, description),
                  ),
                };
              }
              if (kind === "documentClass") {
                return {
                  suggestions: latexDocumentClasses.map(([name, description]) =>
                    item(name, description),
                  ),
                };
              }
              return {
                suggestions: flattenEntries(projectEntriesRef.current)
                  .filter(
                    (entry) =>
                      entry.type === "file" &&
                      projectFileMatchesKind(kind, entry.relativePath),
                  )
                  .map((entry) =>
                    item(
                      projectFileArgument(kind, entry.relativePath),
                      "Project file",
                      projectFileArgument(kind, entry.relativePath),
                      { kind: instance.languages.CompletionItemKind.File },
                    ),
                  ),
              };
            }

            // Default snippet completion (triggered by \)
            if (commandCompletion) {
              const range = completionRange(commandCompletion);
              const builtInSuggestions: Monaco.languages.CompletionItem[] =
                latexCommandSnippets.map((snippet) => ({
                  label: `\\${snippet.label}`,
                  kind: instance.languages.CompletionItemKind.Snippet,
                  insertText: snippet.insertText,
                  insertTextRules:
                    instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  detail: snippet.detail,
                  documentation: snippet.documentation,
                }));
              const mathSuggestions: Monaco.languages.CompletionItem[] =
                SYMBOL_PALETTE.map((symbol) => ({
                  label: symbol.latex,
                  kind: instance.languages.CompletionItemKind.Operator,
                  insertText: symbol.latex,
                  range,
                  detail: `${symbol.display} math symbol`,
                  documentation: symbol.search,
                }));
              const extensionSuggestions: Monaco.languages.CompletionItem[] =
                installedExtensionSnippetsRef.current.map((snippet) => ({
                  label: `\\${snippet.label}`,
                  kind: instance.languages.CompletionItemKind.Snippet,
                  insertText: snippet.insertText,
                  insertTextRules:
                    instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  detail: snippet.detail ?? "Extension snippet",
                  documentation: snippet.documentation,
                }));

              const builtInNames = new Set(
                latexCommandSnippets.map((snippet) => snippet.label),
              );
              const everydaySuggestions: Monaco.languages.CompletionItem[] =
                latexEverydayCommands
                  .filter(([name]) => !builtInNames.has(name))
                  .map(([name, argumentCount, description]) => ({
                    label: `\\${name}`,
                    kind: instance.languages.CompletionItemKind.Function,
                    insertText: `\\${macroSnippet(name, argumentCount)}`,
                    insertTextRules:
                      instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    detail: description,
                  }));
              // Commands this project defines with \newcommand and friends.
              const projectMacroSuggestions: Monaco.languages.CompletionItem[] =
                documentMacros(
                  documentsRef.current
                    .filter((document) => isTextDocument(document))
                    .map((document) => document.content),
                ).map(({ name, argumentCount }) => ({
                  label: `\\${name}`,
                  kind: instance.languages.CompletionItemKind.Variable,
                  insertText: `\\${macroSnippet(name, argumentCount)}`,
                  insertTextRules:
                    instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  detail: "Defined in this project",
                  sortText: `!${name}`,
                }));

              return {
                suggestions: [
                  ...projectMacroSuggestions,
                  ...builtInSuggestions,
                  ...everydaySuggestions,
                  ...mathSuggestions,
                  ...extensionSuggestions,
                ],
              };
            }

            return { suggestions: [] };
          },
        }),
      );
      providerDisposables.push(
        instance.languages.registerHoverProvider("latex", {
          provideHover: (model, position) => {
            const lineContent = model.getLineContent(position.lineNumber);
            const citation = citationKeyAtPosition(lineContent, position.column - 1);
            if (!citation) return null;
            const entry = citationEntriesByKeyRef.current.get(citation.key);
            if (!entry) return null;
            void verifyCitationCached(entry);
            return {
              range: new instance.Range(
                position.lineNumber,
                citation.start + 1,
                position.lineNumber,
                citation.end + 1,
              ),
              contents: [
                {
                  value: citationVerificationMarkdown(
                    entry,
                    peekCachedVerification(entry),
                  ),
                  isTrusted: true,
                },
              ],
            };
          },
        }),
      );
      providerDisposables.push(
        instance.languages.registerHoverProvider("latex", {
          provideHover: async (model, position) => {
            try {
              const { parseMathAtPosition, mathPreviewDataUri } =
                await import("../latex/mathPreview");
              const mathTarget = parseMathAtPosition(
                model.getValue(),
                position.lineNumber,
                position.column,
              );
              if (mathTarget) {
                const foreground =
                  mathPreviewForegrounds[settingsRef.current.colorTheme] ?? "#d7dce5";
                const rendered = mathPreviewDataUri(
                  mathTarget.tex,
                  mathTarget.display,
                  foreground,
                );
                if (rendered) {
                  return {
                    range: new instance.Range(
                      mathTarget.startLine,
                      mathTarget.startColumn,
                      mathTarget.endLine,
                      mathTarget.endColumn,
                    ),
                    contents: [{ value: `![equation](${rendered})` }],
                  };
                }
              }
            } catch {
              // Equation preview is best-effort; fall through to other hovers.
            }

            const includeTarget = parseIncludeGraphicsAtPosition(
              model.getLineContent(position.lineNumber),
              position.column,
            );
            if (!includeTarget) {
              return null;
            }

            const currentProject = projectIdRef.current;
            const document = documentsRef.current.find(
              (item) => item.path === activePathRef.current,
            );
            if (!isSafeIpcProjectId(currentProject) || !document) {
              return null;
            }

            const candidates = figurePreviewCandidatePaths(
              includeTarget.path,
              document.relativePath,
            );
            const range = new instance.Range(
              position.lineNumber,
              includeTarget.startColumn,
              position.lineNumber,
              includeTarget.endColumn,
            );

            if (!candidates.length) {
              return {
                range,
                contents: [
                  {
                    value: `**Figure preview**\n\nCannot resolve \`${includeTarget.rawPath.trim()}\`.`,
                  },
                ],
              };
            }

            for (const candidate of candidates) {
              if (
                !isSafeIpcRelativePath(candidate, [
                  ".png",
                  ".jpg",
                  ".jpeg",
                  ".svg",
                  ".pdf",
                ])
              ) {
                continue;
              }

              if (!figureCanRenderInline(candidate)) {
                if (figurePreviewMimeType(candidate) === "application/pdf") {
                  try {
                    if (await window.latexdo.fileExists(currentProject, candidate)) {
                      return {
                        range,
                        contents: [
                          {
                            value: `**Figure**\n\n\`${candidate}\`\n\nPDF figures preview in the compiled PDF.`,
                          },
                        ],
                      };
                    }
                  } catch {
                    // Try the next candidate.
                  }
                }
                continue;
              }

              const mimeType = figurePreviewMimeType(candidate);
              if (!mimeType) {
                continue;
              }

              try {
                const cacheKey = `${currentProject}:${candidate}`;
                let dataUrl = figurePreviewCacheRef.current.get(cacheKey);
                if (!dataUrl) {
                  if (!(await window.latexdo.fileExists(currentProject, candidate))) {
                    continue;
                  }
                  const bytes = await window.latexdo.readAsset(
                    currentProject,
                    candidate,
                  );
                  dataUrl = figureBytesToDataUrl(bytes, mimeType);
                  figurePreviewCacheRef.current.set(cacheKey, dataUrl);
                }

                return {
                  range,
                  contents: [
                    {
                      supportHtml: true,
                      value: [
                        '<div class="latexdo-figure-hover">',
                        `<strong>${escapeHtml(candidate)}</strong>`,
                        `<img src="${dataUrl}" alt="${escapeHtml(fileName(candidate))}" />`,
                        "</div>",
                      ].join(""),
                    },
                  ],
                };
              } catch {
                // Try the next candidate.
              }
            }

            return {
              range,
              contents: [
                {
                  value: `**Figure not found**\n\nTried: ${candidates
                    .map((candidate) => `\`${candidate}\``)
                    .join(", ")}`,
                },
              ],
            };
          },
        }),
      );
    }
    const sharedRules = [
      { token: "comment", foreground: "6B7280", fontStyle: "italic" },
      { token: "keyword", foreground: "7CA6FF" },
      { token: "keyword.control", foreground: "C099FF" },
      { token: "string", foreground: "8FCB9B" },
      { token: "number", foreground: "E5A66E" },
      { token: "delimiter", foreground: "D5DAE3" },
    ];
    const lightRules = [
      { token: "comment", foreground: "667085", fontStyle: "italic" },
      { token: "keyword", foreground: "1D5FD0" },
      { token: "keyword.control", foreground: "7A3FB3" },
      { token: "string", foreground: "21815F" },
      { token: "number", foreground: "B15D22" },
      { token: "delimiter", foreground: "374151" },
    ];
    const editorSurfaceColors = (background: string) => ({
      "editor.background": background,
      "editorGutter.background": background,
      "editorStickyScroll.background": background,
      "minimap.background": background,
      "editorSuggestWidget.highlightForeground": "#8fcb9b",
      "editorSuggestWidget.focusHighlightForeground": "#d6ffe3",
      "editorSuggestWidget.selectedBackground": "#245c3f",
      "editorSuggestWidget.selectedForeground": "#f2fff6",
      "editorSuggestWidget.selectedIconForeground": "#baf3c7",
    });
    const themes = [
      {
        id: "latexdo-graphite",
        base: "vs-dark" as const,
        rules: sharedRules,
        colors: {
          ...editorSurfaceColors("#15181e"),
          "editor.foreground": "#d7dce5",
          "editorLineNumber.foreground": "#4f5663",
          "editorLineNumber.activeForeground": "#aeb5c1",
          "editor.lineHighlightBackground": "#1b1f27",
          "editorCursor.foreground": "#7ca6ff",
          "editor.selectionBackground": "#31538c88",
          "editor.inactiveSelectionBackground": "#283d5f88",
          "editorIndentGuide.background1": "#252a34",
          "editorIndentGuide.activeBackground1": "#3b4352",
        },
        light: {
          base: "vs" as const,
          rules: lightRules,
          colors: {
            ...editorSurfaceColors("#f6f8fd"),
            "editor.foreground": "#1f2937",
            "editorLineNumber.foreground": "#9aa4b2",
            "editorLineNumber.activeForeground": "#374151",
            "editor.lineHighlightBackground": "#eef3fa",
            "editorCursor.foreground": "#2f6fdb",
            "editor.selectionBackground": "#2f6fdb3d",
            "editor.inactiveSelectionBackground": "#d9e5fa",
            "editorIndentGuide.background1": "#dde4ef",
            "editorIndentGuide.activeBackground1": "#9fb2d0",
          },
        },
      },
      {
        id: "latexdo-midnight",
        base: "vs-dark" as const,
        rules: [
          { token: "comment", foreground: "64748B", fontStyle: "italic" },
          { token: "keyword", foreground: "74B8FF" },
          { token: "keyword.control", foreground: "BFA7FF" },
          { token: "string", foreground: "8DE0C0" },
          { token: "number", foreground: "F3B77A" },
          { token: "delimiter", foreground: "D8E4F4" },
        ],
        colors: {
          ...editorSurfaceColors("#0b1424"),
          "editor.foreground": "#dce8f8",
          "editorLineNumber.foreground": "#536176",
          "editorLineNumber.activeForeground": "#b4c6de",
          "editor.lineHighlightBackground": "#101d31",
          "editorCursor.foreground": "#5fa8ff",
          "editor.selectionBackground": "#235a9288",
          "editor.inactiveSelectionBackground": "#1c3c6388",
          "editorIndentGuide.background1": "#1c2b40",
          "editorIndentGuide.activeBackground1": "#36516f",
        },
        light: {
          base: "vs" as const,
          rules: lightRules,
          colors: {
            ...editorSurfaceColors("#f3f8ff"),
            "editor.foreground": "#1f2937",
            "editorLineNumber.foreground": "#8fa0b8",
            "editorLineNumber.activeForeground": "#3a4a66",
            "editor.lineHighlightBackground": "#e8f0fe",
            "editorCursor.foreground": "#2458c8",
            "editor.selectionBackground": "#2458c83d",
            "editor.inactiveSelectionBackground": "#d9e5f5",
            "editorIndentGuide.background1": "#dbe5f2",
            "editorIndentGuide.activeBackground1": "#9fb0cc",
          },
        },
      },
      {
        id: "latexdo-forest",
        base: "vs-dark" as const,
        rules: [
          { token: "comment", foreground: "6D7D73", fontStyle: "italic" },
          { token: "keyword", foreground: "76D99B" },
          { token: "keyword.control", foreground: "D1B3FF" },
          { token: "string", foreground: "A9D992" },
          { token: "number", foreground: "E7B978" },
          { token: "delimiter", foreground: "DCE7DF" },
        ],
        colors: {
          ...editorSurfaceColors("#111a16"),
          "editor.foreground": "#e1ebe5",
          "editorLineNumber.foreground": "#536159",
          "editorLineNumber.activeForeground": "#b8c8bf",
          "editor.lineHighlightBackground": "#17231d",
          "editorCursor.foreground": "#65c28f",
          "editor.selectionBackground": "#2f6f4c88",
          "editor.inactiveSelectionBackground": "#24483688",
          "editorIndentGuide.background1": "#213029",
          "editorIndentGuide.activeBackground1": "#3a5848",
        },
        light: {
          base: "vs" as const,
          rules: lightRules,
          colors: {
            ...editorSurfaceColors("#f4f8f5"),
            "editor.foreground": "#1f2937",
            "editorLineNumber.foreground": "#96a8a0",
            "editorLineNumber.activeForeground": "#3a4c45",
            "editor.lineHighlightBackground": "#ebf3ee",
            "editorCursor.foreground": "#2f8f6b",
            "editor.selectionBackground": "#2f8f6b3d",
            "editor.inactiveSelectionBackground": "#dbeade",
            "editorIndentGuide.background1": "#dce6e0",
            "editorIndentGuide.activeBackground1": "#a0b6ac",
          },
        },
      },
      {
        id: "latexdo-sepia",
        base: "vs-dark" as const,
        rules: [
          { token: "comment", foreground: "8D7C69", fontStyle: "italic" },
          { token: "keyword", foreground: "E2A86D" },
          { token: "keyword.control", foreground: "D9A6E8" },
          { token: "string", foreground: "B7C982" },
          { token: "number", foreground: "F0BD72" },
          { token: "delimiter", foreground: "E8D9C4" },
        ],
        colors: {
          ...editorSurfaceColors("#1b1510"),
          "editor.foreground": "#eee4d4",
          "editorLineNumber.foreground": "#6d5f50",
          "editorLineNumber.activeForeground": "#cdbda8",
          "editor.lineHighlightBackground": "#241b14",
          "editorCursor.foreground": "#d69a5b",
          "editor.selectionBackground": "#80542e88",
          "editor.inactiveSelectionBackground": "#5d3e2688",
          "editorIndentGuide.background1": "#31261d",
          "editorIndentGuide.activeBackground1": "#5d4633",
        },
        light: {
          base: "vs" as const,
          rules: lightRules,
          colors: {
            ...editorSurfaceColors("#faf5ec"),
            "editor.foreground": "#1f2937",
            "editorLineNumber.foreground": "#a69888",
            "editorLineNumber.activeForeground": "#4a3d2e",
            "editor.lineHighlightBackground": "#f5edde",
            "editorCursor.foreground": "#a06a26",
            "editor.selectionBackground": "#a06a2633",
            "editor.inactiveSelectionBackground": "#ead9c8",
            "editorIndentGuide.background1": "#e7dbca",
            "editorIndentGuide.activeBackground1": "#b3a28b",
          },
        },
      },
      {
        id: "latexdo-studio",
        base: "vs" as const,
        rules: [
          { token: "comment", foreground: "667085", fontStyle: "italic" },
          { token: "keyword", foreground: "1D5FD0" },
          { token: "keyword.control", foreground: "7A3FB3" },
          { token: "string", foreground: "21815F" },
          { token: "number", foreground: "B15D22" },
          { token: "delimiter", foreground: "374151" },
        ],
        colors: {
          ...editorSurfaceColors("#ffffff"),
          "editor.foreground": "#1f2937",
          "editorLineNumber.foreground": "#9aa4b2",
          "editorLineNumber.activeForeground": "#374151",
          "editor.lineHighlightBackground": "#f3f6fb",
          "editorCursor.foreground": "#2f6fdb",
          "editor.selectionBackground": "#c9dcff",
          "editor.inactiveSelectionBackground": "#dce7fb",
          "editorIndentGuide.background1": "#dde4ef",
          "editorIndentGuide.activeBackground1": "#9fb2d0",
        },
        light: {
          base: "vs" as const,
          rules: lightRules,
          colors: {
            ...editorSurfaceColors("#ffffff"),
            "editor.foreground": "#1f2937",
            "editorLineNumber.foreground": "#9aa4b2",
            "editorLineNumber.activeForeground": "#374151",
            "editor.lineHighlightBackground": "#f3f6fb",
            "editorCursor.foreground": "#2f6fdb",
            "editor.selectionBackground": "#c9dcff",
            "editor.inactiveSelectionBackground": "#dce7fb",
            "editorIndentGuide.background1": "#dde4ef",
            "editorIndentGuide.activeBackground1": "#9fb2d0",
          },
        },
      },
      {
        id: "latexdo-paper",
        base: "vs" as const,
        rules: [
          { token: "comment", foreground: "6b7280", fontStyle: "italic" },
          { token: "keyword", foreground: "1f6eb3" },
          { token: "keyword.control", foreground: "8b4aa6" },
          { token: "string", foreground: "1d7a56" },
          { token: "number", foreground: "a65f1b" },
          { token: "delimiter", foreground: "3a414c" },
        ],
        colors: {
          ...editorSurfaceColors("#fffefa"),
          "editor.foreground": "#252a31",
          "editorLineNumber.foreground": "#a0a8b2",
          "editorLineNumber.activeForeground": "#3a414c",
          "editor.lineHighlightBackground": "#f2f6f1",
          "editorCursor.foreground": "#2f8f6b",
          "editor.selectionBackground": "#cce8d9",
          "editor.inactiveSelectionBackground": "#e1efe7",
          "editorIndentGuide.background1": "#dce5dd",
          "editorIndentGuide.activeBackground1": "#98b6a6",
        },
        light: {
          base: "vs" as const,
          rules: lightRules,
          colors: {
            ...editorSurfaceColors("#fffefa"),
            "editor.foreground": "#252a31",
            "editorLineNumber.foreground": "#a0a8b2",
            "editorLineNumber.activeForeground": "#3a414c",
            "editor.lineHighlightBackground": "#f2f6f1",
            "editorCursor.foreground": "#2f8f6b",
            "editor.selectionBackground": "#cce8d9",
            "editor.inactiveSelectionBackground": "#e1efe7",
            "editorIndentGuide.background1": "#dce5dd",
            "editorIndentGuide.activeBackground1": "#98b6a6",
          },
        },
      },
    ];

    for (const theme of themes) {
      instance.editor.defineTheme(theme.id, {
        base: theme.base,
        inherit: true,
        rules: theme.rules,
        colors: theme.colors,
      });
      const lightId = `latexdo-light-${theme.id.slice("latexdo-".length)}`;
      instance.editor.defineTheme(lightId, {
        base: theme.light.base,
        inherit: true,
        rules: theme.light.rules,
        colors: theme.light.colors,
      });
    }
  };

  return { configureMonaco };
}
