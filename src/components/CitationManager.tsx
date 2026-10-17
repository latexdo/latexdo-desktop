import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  CornerDownLeft,
  FilePlus2,
  Files,
  Link2,
  LoaderCircle,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { CitationEntry } from "../latex/latexIndex";
import {
  citationQualityScore,
  citationVenue,
  createBibtexStub,
  type CitationLibraryAnalysis,
} from "../latex/citationAnalysis";
import type { CitationVerification } from "../features/citations/citationVerification";

type CitationManagerTab = "library" | "used" | "gaps" | "quality";
export type CitationInsertCommand = "cite" | "citep" | "citet" | "parencite";

interface CitationManagerProps {
  analysis: CitationLibraryAnalysis;
  loading?: boolean;
  error?: string;
  activeDocumentPath?: string;
  onInsertCitation?: (key: string, command: CitationInsertCommand) => void;
  onAppendBibEntry?: (targetFile: string, bibtex: string) => void;
  /** Merges every .bib file of the project into one. */
  onMergeBibFiles?: () => void;
  onRemoveUnused?: () => void;
  onClose?: () => void;
  verifyEntry?: (entry: CitationEntry) => Promise<CitationVerification>;
}

const citationTabs: Array<{ id: CitationManagerTab; label: string }> = [
  { id: "library", label: "Library" },
  { id: "used", label: "Cited" },
  { id: "gaps", label: "Missing" },
  { id: "quality", label: "Quality" },
];

/** Rows drawn at once; large shared bibliographies have thousands. */
const pageSize = 200;

const citationCommands: Array<{
  command: CitationInsertCommand;
  label: string;
  description: string;
}> = [
  { command: "cite", label: "\\cite", description: "Standard citation" },
  { command: "citep", label: "\\citep", description: "Parenthetical" },
  { command: "citet", label: "\\citet", description: "Textual author cite" },
  { command: "parencite", label: "\\parencite", description: "biblatex style" },
];

function verificationStatusLabel(status: CitationVerification["status"]): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "probable":
      return "Likely";
    case "mismatch":
      return "DOI conflict";
    case "unverified":
      return "Unverified";
    case "error":
      return "Error";
  }
}

function verificationStatusTitle(verification: CitationVerification): string {
  const match = verification.matches[0];
  switch (verification.status) {
    case "verified":
      return `Verified against ${match?.provider ?? "Crossref"}`;
    case "probable":
      return `Likely a match (${Math.round((match?.score ?? 0) * 100)}%)`;
    case "mismatch":
      return "Recorded DOI disagrees with the matching paper";
    case "unverified":
      return "No matching scholarly record found";
    case "error":
      return verification.error
        ? `Verification unavailable (${verification.error})`
        : "Verification unavailable";
  }
}

function entrySearchText(entry: CitationEntry): string {
  return [
    entry.key,
    entry.type,
    entry.title,
    entry.author,
    entry.editor,
    entry.year,
    citationVenue(entry),
    entry.doi,
    entry.url,
    entry.eprint,
    entry.abstract,
    entry.keywords,
    entry.sourceFile,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatPeople(entry: CitationEntry): string {
  return entry.author ?? entry.editor ?? "Unknown author";
}

function entryBibtexPreview(entry: CitationEntry): string {
  const fields = [
    ["title", entry.title],
    ["author", entry.author],
    ["editor", entry.editor],
    ["year", entry.year],
    ["journal", entry.journal],
    ["booktitle", entry.booktitle],
    ["publisher", entry.publisher],
    ["school", entry.school],
    ["institution", entry.institution],
    ["doi", entry.doi],
    ["url", entry.url],
    ["eprint", entry.eprint],
    ["abstract", entry.abstract],
    ["keywords", entry.keywords],
  ].filter((field): field is [string, string] => Boolean(field[1]));

  return [
    `@${entry.type || "misc"}{${entry.key},`,
    ...fields.map(([name, value], index) => {
      const comma = index === fields.length - 1 ? "" : ",";
      return `  ${name} = {${value}}${comma}`;
    }),
    "}",
  ].join("\n");
}

function firstUsageLabel(
  usagesByKey: Map<string, Array<{ sourceFile: string; line: number }>>,
  key: string,
): string {
  const first = usagesByKey.get(key)?.[0];
  return first ? `${first.sourceFile}:${first.line}` : "Not cited";
}

export function CitationManager({
  analysis,
  loading = false,
  error = "",
  onInsertCitation,
  onAppendBibEntry,
  onMergeBibFiles,
  onRemoveUnused,
  onClose,
  verifyEntry,
}: CitationManagerProps) {
  const [activeTab, setActiveTab] = useState<CitationManagerTab>("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCommand, setSelectedCommand] = useState<CitationInsertCommand>("cite");
  const [targetBibFile, setTargetBibFile] = useState(analysis.bibFiles[0] ?? "");
  const [copied, setCopied] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [verificationByKey, setVerificationByKey] = useState<
    ReadonlyMap<string, CitationVerification>
  >(() => new Map());
  const verificationWorkerIndex = useRef(0);
  const verificationStale = useRef(false);

  // Only the references the paper cites are checked online: a shared lab
  // bibliography can hold thousands of entries nobody cites here.
  const entriesToVerify = useMemo(() => {
    const cited = new Set(analysis.citedKeys);
    return analysis.entries.filter((entry) => cited.has(entry.key));
  }, [analysis.entries, analysis.citedKeys]);

  useEffect(() => {
    if (!verifyEntry || entriesToVerify.length === 0) {
      verificationWorkerIndex.current = 0;
      return;
    }
    verificationStale.current = false;
    verificationWorkerIndex.current = 0;

    const worker = async () => {
      while (!verificationStale.current) {
        const index = verificationWorkerIndex.current;
        verificationWorkerIndex.current += 1;
        if (index >= entriesToVerify.length) return;
        const entry = entriesToVerify[index];
        if (!entry.key) continue;
        try {
          const verification = await verifyEntry(entry);
          if (verificationStale.current) return;
          setVerificationByKey((prev) => new Map(prev).set(entry.key, verification));
        } catch {
          // Abort or provider failure; the global cache records errors itself.
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(3, Math.max(entriesToVerify.length, 1)) },
      () => {
        void worker();
      },
    );
    void Promise.all(workers);

    return () => {
      verificationStale.current = true;
    };
  }, [entriesToVerify, verifyEntry]);

  useEffect(() => {
    if (!analysis.bibFiles.length) {
      setTargetBibFile("");
      return;
    }
    if (!targetBibFile || !analysis.bibFiles.includes(targetBibFile)) {
      setTargetBibFile(analysis.bibFiles[0]);
    }
  }, [analysis.bibFiles, targetBibFile]);

  const usageCountByKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const usage of analysis.usages) {
      counts.set(usage.key, (counts.get(usage.key) ?? 0) + 1);
    }
    return counts;
  }, [analysis.usages]);

  const usagesByKey = useMemo(() => {
    const grouped = new Map<string, Array<{ sourceFile: string; line: number }>>();
    for (const usage of analysis.usages) {
      grouped.set(usage.key, [
        ...(grouped.get(usage.key) ?? []),
        { sourceFile: usage.sourceFile, line: usage.line },
      ]);
    }
    return grouped;
  }, [analysis.usages]);

  const entriesByKey = useMemo(() => {
    const byKey = new Map<string, CitationEntry>();
    for (const entry of analysis.entries) {
      if (!byKey.has(entry.key)) {
        byKey.set(entry.key, entry);
      }
    }
    return byKey;
  }, [analysis.entries]);

  const qualityIssuesByKey = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const issue of analysis.qualityIssues) {
      grouped.set(issue.key, [...(grouped.get(issue.key) ?? []), issue.message]);
    }
    return grouped;
  }, [analysis.qualityIssues]);

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const entries = query
      ? analysis.entries.filter((entry) => entrySearchText(entry).includes(query))
      : analysis.entries;

    return [...entries].sort((a, b) => {
      const usageDelta =
        (usageCountByKey.get(b.key) ?? 0) - (usageCountByKey.get(a.key) ?? 0);
      if (usageDelta !== 0) return usageDelta;
      const scoreDelta = citationQualityScore(b) - citationQualityScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      return a.key.localeCompare(b.key);
    });
  }, [analysis.entries, searchQuery, usageCountByKey]);

  const citedRows = useMemo(
    () =>
      analysis.citedKeys.map((key) => ({
        key,
        entry: entriesByKey.get(key),
        usages: usagesByKey.get(key) ?? [],
      })),
    [analysis.citedKeys, entriesByKey, usagesByKey],
  );

  const copyText = useCallback(async (label: string, text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    }
  }, []);

  const handleInsert = useCallback(
    (key: string) => {
      if (!onInsertCitation) return;
      onInsertCitation(key, selectedCommand);
    },
    [onInsertCitation, selectedCommand],
  );

  const handleAddStub = useCallback(
    (key: string) => {
      const file = targetBibFile || analysis.bibFiles[0];
      if (!file || !onAppendBibEntry) return;
      onAppendBibEntry(file, createBibtexStub(key));
    },
    [analysis.bibFiles, onAppendBibEntry, targetBibFile],
  );

  useEffect(() => setVisibleCount(pageSize), [searchQuery, activeTab]);

  const stats: Array<{
    label: string;
    value: number;
    tab: CitationManagerTab;
    tone?: string;
  }> = [
    { label: "entries", value: analysis.entries.length, tab: "library" },
    { label: "cited", value: analysis.citedKeys.length, tab: "used" },
    {
      label: "missing",
      value: analysis.missingKeys.length,
      tab: "gaps",
      tone: analysis.missingKeys.length ? "danger" : undefined,
    },
    {
      label: "unused",
      value: analysis.unusedKeys.length,
      tab: "library",
      tone: analysis.unusedKeys.length ? "muted" : undefined,
    },
  ];
  const tabCount: Partial<Record<CitationManagerTab, number>> = {
    library: analysis.entries.length,
    used: analysis.citedKeys.length,
    gaps: analysis.missingKeys.length,
    quality: analysis.qualityIssues.length + analysis.duplicateGroups.length,
  };

  return (
    <div className="citation-manager-root">
      <header className="citation-manager-header">
        <h2>Bibliography</h2>
        <div className="citation-manager-stats" aria-label="Bibliography summary">
          {stats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              className={`citation-manager-stat ${stat.tone ?? ""}`}
              onClick={() => setActiveTab(stat.tab)}
            >
              <strong>{stat.value.toLocaleString()}</strong> {stat.label}
            </button>
          ))}
          {loading ? (
            <span className="citation-manager-status">
              <LoaderCircle size={12} className="spin" /> Scanning…
            </span>
          ) : copied ? (
            <span className="citation-manager-status" role="status">
              Copied {copied}
            </span>
          ) : null}
        </div>
        <div className="citation-manager-header-actions">
          {analysis.bibFiles.length > 1 && onMergeBibFiles ? (
            <button
              type="button"
              className="citation-manager-action"
              onClick={onMergeBibFiles}
              title={`Merge ${analysis.bibFiles.join(", ")} into one file`}
            >
              <Files size={13} />
              Merge into one .bib
            </button>
          ) : null}
          {onRemoveUnused ? (
            <button
              type="button"
              className="citation-manager-action danger"
              onClick={onRemoveUnused}
              disabled={loading || Boolean(error) || !analysis.unusedKeys.length}
              aria-label="Remove unused entries"
              title="Review and remove the entries no .tex file cites"
            >
              <Trash2 size={13} />
              Remove unused
              {analysis.unusedKeys.length ? (
                <span className="citation-manager-action-count">
                  {analysis.unusedKeys.length.toLocaleString()}
                </span>
              ) : null}
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="citation-manager-close"
              onClick={onClose}
              aria-label="Close citation manager"
              title="Close (Esc)"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="citation-manager-alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="citation-manager-toolbar">
        <div className="citation-manager-tabs" role="tablist">
          {citationTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tabCount[tab.id] ? (
                <span
                  className={`citation-manager-tab-count ${
                    tab.id === "gaps" ? "danger" : ""
                  }`}
                >
                  {tabCount[tab.id]!.toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <label className="citation-manager-search">
          <Search size={14} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by key, title, author, DOI, venue..."
          />
        </label>
        <select
          value={selectedCommand}
          onChange={(event) =>
            setSelectedCommand(event.target.value as CitationInsertCommand)
          }
          aria-label="Citation command"
          title="Command used by Insert and Copy cite"
        >
          {citationCommands.map((command) => (
            <option key={command.command} value={command.command}>
              {command.label}
            </option>
          ))}
        </select>
      </div>

      <div className="citation-manager-body">
        {activeTab === "library" ? (
          <div className="citation-manager-list">
            {filteredEntries.length ? (
              filteredEntries.slice(0, visibleCount).map((entry) => {
                const usageCount = usageCountByKey.get(entry.key) ?? 0;
                const score = citationQualityScore(entry);
                const issues = qualityIssuesByKey.get(entry.key) ?? [];
                return (
                  <article
                    key={`${entry.sourceFile}:${entry.key}`}
                    className="citation-card"
                  >
                    <div className="citation-card-main">
                      <div className="citation-card-heading">
                        <strong>{entry.key}</strong>
                        <span className={usageCount ? "used" : "unused"}>
                          {usageCount ? `Cited ${usageCount}×` : "Unused"}
                        </span>
                        {score < 60 ? (
                          <span
                            className="weak"
                            title={`${score}% of the usual fields`}
                          >
                            Incomplete
                          </span>
                        ) : null}
                        {verificationByKey.has(entry.key) ? (
                          <span
                            className={`citation-verification ${
                              verificationByKey.get(entry.key)?.status ?? "error"
                            }`}
                            title={verificationStatusTitle(
                              verificationByKey.get(entry.key)!,
                            )}
                          >
                            {verificationStatusLabel(
                              verificationByKey.get(entry.key)!.status,
                            )}
                          </span>
                        ) : null}
                      </div>
                      <h3>{entry.title || "Untitled reference"}</h3>
                      <p>
                        {formatPeople(entry)}
                        {entry.year ? `, ${entry.year}` : ""} · {citationVenue(entry)}
                      </p>
                      <div className="citation-card-foot">
                        <span>{entry.sourceFile}</span>
                        {usageCount ? (
                          <span>{firstUsageLabel(usagesByKey, entry.key)}</span>
                        ) : null}
                        {entry.doi || entry.url ? (
                          <span className="citation-link-pill">
                            <Link2 size={11} />
                            {entry.doi ? "DOI" : "URL"}
                          </span>
                        ) : null}
                      </div>
                      {issues.length ? (
                        <div className="citation-card-issues">
                          {issues.slice(0, 3).map((issue) => (
                            <span key={issue}>{issue}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="citation-card-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => handleInsert(entry.key)}
                        disabled={!onInsertCitation}
                        aria-label="Insert"
                        title={`Insert \\${selectedCommand}{${entry.key}} at the cursor`}
                      >
                        <CornerDownLeft size={12} />
                        Insert
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(entry.key, `\\${selectedCommand}{${entry.key}}`)
                        }
                        aria-label="Copy cite"
                        title={`Copy \\${selectedCommand}{${entry.key}}`}
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(`${entry.key}.bib`, entryBibtexPreview(entry))
                        }
                        aria-label="Copy BibTeX"
                        title="Copy the BibTeX entry"
                      >
                        <Clipboard size={12} />
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="citation-manager-empty">
                {analysis.entries.length
                  ? "No references match the current search."
                  : "No .bib entries found in this project."}
              </div>
            )}
            {filteredEntries.length > visibleCount ? (
              <button
                type="button"
                className="citation-manager-more"
                onClick={() => setVisibleCount((count) => count + pageSize * 5)}
              >
                Show more ({(filteredEntries.length - visibleCount).toLocaleString()}{" "}
                more)
              </button>
            ) : null}
          </div>
        ) : null}

        {activeTab === "used" ? (
          <div className="citation-manager-list">
            {citedRows.length ? (
              citedRows.map((row) => (
                <article
                  key={row.key}
                  className={`citation-usage-row ${row.entry ? "" : "missing"}`}
                >
                  <div>
                    <strong>{row.key}</strong>
                    <span>
                      {row.entry
                        ? row.entry.title || "Defined bibliography entry"
                        : "Missing from every .bib file"}
                    </span>
                    <small>
                      {row.usages
                        .slice(0, 4)
                        .map((usage) => `${usage.sourceFile}:${usage.line}`)
                        .join(", ")}
                    </small>
                  </div>
                  <div>
                    {row.entry ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                    <span>
                      {row.usages.length} use{row.usages.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </article>
              ))
            ) : (
              <div className="citation-manager-empty">
                No citation commands found in the project .tex files.
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "gaps" ? (
          <div className="citation-manager-list">
            <div className="citation-manager-target">
              <span>Add stubs to</span>
              <select
                value={targetBibFile || analysis.bibFiles[0] || ""}
                onChange={(event) => setTargetBibFile(event.target.value)}
                disabled={!analysis.bibFiles.length}
              >
                {analysis.bibFiles.length ? (
                  analysis.bibFiles.map((file) => (
                    <option key={file} value={file}>
                      {file}
                    </option>
                  ))
                ) : (
                  <option value="">No .bib file</option>
                )}
              </select>
            </div>

            {analysis.missingKeys.length ? (
              analysis.missingKeys.map((key) => {
                const stub = createBibtexStub(key);
                const locations = usagesByKey.get(key) ?? [];
                return (
                  <article key={key} className="citation-gap-card">
                    <div>
                      <strong>{key}</strong>
                      <span>Not in any .bib file</span>
                      <small>
                        {locations
                          .slice(0, 4)
                          .map((usage) => `${usage.sourceFile}:${usage.line}`)
                          .join(", ")}
                      </small>
                    </div>
                    <div className="citation-card-actions">
                      <button
                        type="button"
                        onClick={() => void copyText(`${key}.stub`, stub)}
                      >
                        <Copy size={12} />
                        Copy stub
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddStub(key)}
                        disabled={!onAppendBibEntry || !analysis.bibFiles.length}
                      >
                        <FilePlus2 size={12} />
                        Add stub
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="citation-manager-empty">
                Every cited key is defined in a .bib file.
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "quality" ? (
          <div className="citation-manager-list">
            <section className="citation-quality-section">
              <h3>Duplicates</h3>
              {analysis.duplicateGroups.length ? (
                analysis.duplicateGroups.map((group) => (
                  <div
                    key={`${group.reason}:${group.value}`}
                    className="citation-quality-card"
                  >
                    <strong>
                      {group.reason.toUpperCase()}: {group.value}
                    </strong>
                    <span>
                      {group.entries
                        .map((entry) => `${entry.key} (${entry.sourceFile})`)
                        .join(", ")}
                    </span>
                  </div>
                ))
              ) : (
                <div className="citation-manager-empty compact">
                  No duplicate key, DOI, or title signals found.
                </div>
              )}
            </section>

            <section className="citation-quality-section">
              <h3>Missing fields</h3>
              {analysis.qualityIssues.length ? (
                analysis.qualityIssues.slice(0, 80).map((issue) => (
                  <div
                    key={`${issue.key}:${issue.message}:${issue.sourceFile}`}
                    className={`citation-quality-card ${issue.severity}`}
                  >
                    <strong>{issue.key}</strong>
                    <span>{issue.message}</span>
                    <small>{issue.sourceFile}</small>
                  </div>
                ))
              ) : (
                <div className="citation-manager-empty compact">
                  Every entry has core metadata.
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
