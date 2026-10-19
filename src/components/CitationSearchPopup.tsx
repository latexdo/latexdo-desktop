import {
  BookOpen,
  Check,
  Clock3,
  Globe,
  Loader2,
  Search,
  TextQuote,
} from "lucide-react";
import {
  forwardRef,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  citationMatchesQuery,
  rankedCitationCompletions,
} from "../latex/citationCompletion";
import type { CitationEntry } from "../latex/latexIndex";
import {
  citationContextFit,
  citationContextTerms,
  libraryEntryForPaper,
  onlineQueryFor,
  type ContextFit,
} from "../features/citations/citationAssistant";
import { recommendCitations } from "../features/graph/citationRecommender";
import type { ScholarlyPaper } from "../features/scholarly/scholarlyTypes";

/** Rows rendered at once; large bibliographies are narrowed by typing. */
const MAX_VISIBLE_RESULTS = 60;
const COLLAPSED_HEIGHT = 30;
const EXPANDED_MAX_HEIGHT = 400;
const POPUP_WIDTH = 500;
const VIEWPORT_MARGIN = 8;
const ONLINE_DEBOUNCE_MS = 450;

export interface CitationSearchAnchor {
  /** Viewport x of the citation key being typed. */
  left: number;
  /** Viewport y of the top of the caret line. */
  top: number;
  /** Viewport y of the bottom of the caret line. */
  bottom: number;
}

export interface CitationSearchContext {
  /** Keys picked recently or cited near the caret, most relevant first. */
  recentKeys: string[];
  /** The text around the caret, used to judge whether a reference fits. */
  sentence: string;
  /** The key fragment already typed inside \cite{...}. */
  query?: string;
}

type Tab = "library" | "recent" | "suggested" | "online";

const tabLabels: Record<Tab, string> = {
  library: "Library",
  recent: "Recent",
  suggested: "For this sentence",
  online: "Online",
};

const tabIcons: Record<Tab, React.ReactNode> = {
  library: <BookOpen size={14} aria-hidden="true" />,
  recent: <Clock3 size={14} aria-hidden="true" />,
  suggested: <TextQuote size={14} aria-hidden="true" />,
  online: <Globe size={14} aria-hidden="true" />,
};

type Row =
  | { kind: "entry"; entry: CitationEntry; reason?: string }
  | { kind: "paper"; paper: ScholarlyPaper; existing?: CitationEntry };

interface CitationSearchPopupProps {
  anchor: CitationSearchAnchor;
  entries: CitationEntry[];
  citedKeys: ReadonlySet<string>;
  /** Non-zero values request keyboard focus for the search field. */
  focusRequest: number;
  shortcutLabel: string;
  onFocusHandled: () => void;
  onPick: (entry: CitationEntry) => void;
  /** Called when the user leaves the search with Escape. */
  onDismiss: () => void;
  /** Called when focus moves from the search to somewhere outside it. */
  onLeave: () => void;
  /** What is already typed inside \cite{...}; the search starts from it. */
  initialQuery?: string;
  /** Read each time the search opens. */
  readContext?: () => CitationSearchContext;
  /** Searches scholarly indexes; the Online list is hidden without it. */
  onSearchOnline?: (query: string, signal: AbortSignal) => Promise<ScholarlyPaper[]>;
  /** Writes a BibTeX entry for the paper and cites it. */
  onAddOnline?: (paper: ScholarlyPaper) => Promise<void> | void;
}

function fitNote(fit: ContextFit): string | null {
  if (fit.kind === "fits") {
    return `Fits this sentence — it shares ${fit.shared
      .map((term) => `“${term}”`)
      .join(", ")}`;
  }
  if (fit.kind === "weak") {
    return "May not fit here — nothing in its title matches the sentence you are writing";
  }
  return null;
}

export const CitationSearchPopup = forwardRef<HTMLDivElement, CitationSearchPopupProps>(
  function CitationSearchPopup(
    {
      anchor,
      entries,
      citedKeys,
      focusRequest,
      shortcutLabel,
      onFocusHandled,
      onPick,
      onDismiss,
      onLeave,
      initialQuery = "",
      readContext,
      onSearchOnline,
      onAddOnline,
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [tab, setTab] = useState<Tab>("library");
    const [context, setContext] = useState<CitationSearchContext>({
      recentKeys: [],
      sentence: "",
    });
    const [online, setOnline] = useState<{
      status: "idle" | "loading" | "done" | "error";
      papers: ScholarlyPaper[];
      query: string;
    }>({ status: "idle", papers: [], query: "" });
    const [adding, setAdding] = useState(false);
    const deferredQuery = useDeferredValue(query);

    const tabs = useMemo<Tab[]>(
      () =>
        onSearchOnline
          ? ["library", "recent", "suggested", "online"]
          : ["library", "recent", "suggested"],
      [onSearchOnline],
    );
    const contextTerms = useMemo(
      () => citationContextTerms(context.sentence),
      [context.sentence],
    );
    const byKey = useMemo(
      () => new Map(entries.map((entry) => [entry.key, entry])),
      [entries],
    );
    const recentSet = useMemo(() => new Set(context.recentKeys), [context.recentKeys]);

    const rows = useMemo<Row[]>(() => {
      if (!expanded) return [];
      const matching = (entry: CitationEntry) =>
        !deferredQuery.trim() || citationMatchesQuery(entry, deferredQuery);
      if (tab === "recent") {
        return context.recentKeys
          .map((key) => byKey.get(key))
          .filter((entry): entry is CitationEntry => Boolean(entry && matching(entry)))
          .map((entry) => ({ kind: "entry", entry }));
      }
      if (tab === "suggested") {
        return recommendCitations(context.sentence, entries, { limit: 15 })
          .filter((recommendation) => matching(recommendation.entry))
          .map((recommendation) => ({
            kind: "entry",
            entry: recommendation.entry,
            reason: recommendation.reasons[0],
          }));
      }
      if (tab === "online") {
        return online.papers.map((paper) => ({
          kind: "paper",
          paper,
          existing: libraryEntryForPaper(paper, entries),
        }));
      }
      const ranked = rankedCitationCompletions(entries, deferredQuery);
      if (deferredQuery.trim())
        return ranked.map((entry) => ({ kind: "entry", entry }));
      // Nothing typed yet: what this paper uses, then what fits the sentence.
      const recent = context.recentKeys
        .map((key) => byKey.get(key))
        .filter((entry): entry is CitationEntry => Boolean(entry));
      const shown = new Set(recent.map((entry) => entry.key));
      const fitting = ranked.filter(
        (entry) =>
          !shown.has(entry.key) &&
          citationContextFit(entry, contextTerms).kind === "fits",
      );
      for (const entry of fitting) shown.add(entry.key);
      return [
        ...recent,
        ...fitting,
        ...ranked.filter((entry) => !shown.has(entry.key)),
      ].map((entry) => ({ kind: "entry", entry }));
    }, [
      byKey,
      context,
      contextTerms,
      deferredQuery,
      entries,
      expanded,
      online.papers,
      tab,
    ]);
    const visibleRows = useMemo(() => rows.slice(0, MAX_VISIBLE_RESULTS), [rows]);
    const onlineQuery = onlineQueryFor(deferredQuery, contextTerms);

    useEffect(() => {
      if (!expanded || tab !== "online" || !onSearchOnline) return;
      if (!onlineQuery) {
        setOnline({ status: "idle", papers: [], query: "" });
        return;
      }
      const controller = new AbortController();
      const timer = window.setTimeout(() => {
        setOnline((current) => ({ ...current, status: "loading", query: onlineQuery }));
        onSearchOnline(onlineQuery, controller.signal).then(
          (papers) => {
            if (!controller.signal.aborted) {
              setOnline({ status: "done", papers, query: onlineQuery });
            }
          },
          () => {
            if (!controller.signal.aborted) {
              setOnline({ status: "error", papers: [], query: onlineQuery });
            }
          },
        );
      }, ONLINE_DEBOUNCE_MS);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }, [expanded, onSearchOnline, onlineQuery, tab]);

    useEffect(() => {
      if (!focusRequest) return;
      inputRef.current?.focus();
      inputRef.current?.select();
      onFocusHandled();
    }, [focusRequest, onFocusHandled]);

    useEffect(() => {
      setActiveIndex(0);
    }, [deferredQuery, tab]);

    useLayoutEffect(() => {
      listRef.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.scrollIntoView?.({ block: "nearest" });
    }, [activeIndex, visibleRows]);

    const width = Math.min(POPUP_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchor.left, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    const roomBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN;
    const roomAbove = anchor.top - VIEWPORT_MARGIN;
    // Collapsed, the bar sits above the caret so the inline suggestion list
    // (which opens below) stays visible. Expanded, it takes that list's place.
    const placeBelow = expanded
      ? roomBelow >= Math.min(EXPANDED_MAX_HEIGHT, 200) || roomBelow >= roomAbove
      : roomAbove < COLLAPSED_HEIGHT + 4;
    const style: React.CSSProperties = placeBelow
      ? {
          left,
          width,
          top: anchor.bottom + 4,
          maxHeight: Math.max(140, Math.min(EXPANDED_MAX_HEIGHT, roomBelow - 4)),
        }
      : {
          left,
          width,
          bottom: window.innerHeight - anchor.top + 4,
          maxHeight: Math.max(140, Math.min(EXPANDED_MAX_HEIGHT, roomAbove - 4)),
        };

    const open = () => {
      if (expanded) return;
      setExpanded(true);
      setTab("library");
      const next = readContext?.();
      if (next) setContext(next);
      setQuery(next?.query ?? initialQuery);
    };

    const close = () => {
      setExpanded(false);
      setQuery("");
      setTab("library");
    };

    const pick = async (row: Row | undefined) => {
      if (!row || adding) return;
      if (row.kind === "entry") {
        close();
        onPick(row.entry);
      } else if (row.existing) {
        close();
        onPick(row.existing);
      } else if (onAddOnline) {
        setAdding(true);
        try {
          await onAddOnline(row.paper);
          close();
        } finally {
          setAdding(false);
        }
      }
    };

    const moveTab = (step: number) => {
      const next = (tabs.indexOf(tab) + step + tabs.length) % tabs.length;
      setTab(tabs[next]);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      const digit = Number(event.key);
      if ((event.metaKey || event.ctrlKey) && digit >= 1 && digit <= tabs.length) {
        event.preventDefault();
        setTab(tabs[digit - 1]);
      } else if (event.key === "Tab") {
        event.preventDefault();
        moveTab(event.shiftKey ? -1 : 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(visibleRows.length - 1, index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
      } else if (event.key === "PageDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(visibleRows.length - 1, index + 8));
      } else if (event.key === "PageUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 8));
      } else if (event.key === "Enter") {
        event.preventDefault();
        void pick(visibleRows[activeIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        onDismiss();
      }
    };

    const total = entries.length;
    const listId = "citation-search-results";
    const activeRow = visibleRows[activeIndex];
    const activeNote =
      activeRow?.kind === "entry"
        ? (fitNote(citationContextFit(activeRow.entry, contextTerms)) ??
          activeRow.reason ??
          null)
        : activeRow?.kind === "paper"
          ? activeRow.existing
            ? `Already in your library as ${activeRow.existing.key} — Enter cites it`
            : "Enter writes a BibTeX entry to your .bib file and cites it"
          : null;

    const emptyText =
      tab === "recent"
        ? "Nothing cited near here yet. Citations you pick show up in this list."
        : tab === "suggested"
          ? "Write a few words of the sentence first; references that match it appear here."
          : tab === "online"
            ? online.status === "error"
              ? "Could not reach Crossref or OpenAlex. Check your connection and try again."
              : online.status === "loading" || online.query !== onlineQuery
                ? "Searching Crossref and OpenAlex…"
                : onlineQuery
                  ? "Nothing found online. Try other words."
                  : "Type a title, author or topic to search online."
            : total
              ? "No references match. Try a title word, author or year."
              : "No .bib entries found in this project.";

    return (
      <div
        ref={ref}
        className={`citation-search-popup ${expanded ? "expanded" : "collapsed"}`}
        style={style}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            close();
            onLeave();
          }
        }}
      >
        <label className="citation-search-field">
          {tab === "online" && expanded ? (
            <Globe size={13} aria-hidden="true" />
          ) : (
            <Search size={13} aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              expanded && activeRow ? `citation-search-${activeIndex}` : undefined
            }
            aria-label="Search bibliography"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={open}
            onKeyDown={handleKeyDown}
            placeholder={
              expanded && tab === "online"
                ? "Search Crossref and OpenAlex…"
                : `Search ${total.toLocaleString()} reference${total === 1 ? "" : "s"} by title, author, year…`
            }
            spellCheck={false}
            autoComplete="off"
          />
          {expanded ? (
            online.status === "loading" && tab === "online" ? (
              <Loader2 size={13} className="spin" aria-label="Searching online" />
            ) : (
              <span className="citation-search-count">
                {rows.length.toLocaleString()} result{rows.length === 1 ? "" : "s"}
              </span>
            )
          ) : (
            <kbd>{shortcutLabel}</kbd>
          )}
        </label>
        {expanded ? (
          <>
            <div
              className="citation-search-tabs"
              role="tablist"
              aria-label="Citation lists"
            >
              {tabs.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={tab === item}
                  className={tab === item ? "active" : ""}
                  title={`${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}${index + 1}`}
                  // Keep focus in the search field.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setTab(item)}
                >
                  {tabIcons[item]}
                  {tabLabels[item]}
                </button>
              ))}
            </div>
            <div
              ref={listRef}
              id={listId}
              className="citation-search-results"
              role="listbox"
              aria-label={
                tab === "online" ? "References found online" : "Matching references"
              }
            >
              {visibleRows.length ? (
                visibleRows.map((row, index) => (
                  <div
                    key={
                      row.kind === "entry"
                        ? `${row.entry.sourceFile}:${row.entry.key}:${index}`
                        : `online:${row.paper.doi ?? row.paper.title}:${index}`
                    }
                    id={`citation-search-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`citation-search-row ${index === activeIndex ? "active" : ""}`}
                    // Keep focus in the search field so a click picks at once.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => void pick(row)}
                  >
                    {row.kind === "entry" ? (
                      <EntryRow
                        entry={row.entry}
                        cited={citedKeys.has(row.entry.key)}
                        recent={recentSet.has(row.entry.key)}
                        fits={
                          citationContextFit(row.entry, contextTerms).kind === "fits"
                        }
                        suggested={tab === "suggested"}
                      />
                    ) : (
                      <PaperRow paper={row.paper} existing={row.existing} />
                    )}
                  </div>
                ))
              ) : (
                <div className="citation-search-empty">{emptyText}</div>
              )}
            </div>
            {activeNote ? (
              <div className="citation-search-note" role="status">
                {activeNote}
              </div>
            ) : null}
            <div className="citation-search-footer">
              <span>
                {rows.length > visibleRows.length
                  ? `Showing ${visibleRows.length} of ${rows.length.toLocaleString()} — keep typing to narrow`
                  : adding
                    ? "Adding to your bibliography…"
                    : "↑↓ move · Tab next list"}
              </span>
              <span>Enter insert · Esc close</span>
            </div>
          </>
        ) : null}
      </div>
    );
  },
);

function EntryRow({
  entry,
  cited,
  recent,
  fits,
  suggested,
}: {
  entry: CitationEntry;
  cited: boolean;
  recent: boolean;
  fits: boolean;
  suggested: boolean;
}) {
  const people = entry.author ?? entry.editor;
  const venue = entry.journal ?? entry.booktitle ?? entry.publisher;
  const meta = [people, entry.year, venue].filter(Boolean).join(" · ");
  return (
    <>
      <div className="citation-search-row-top">
        <code>{entry.key}</code>
        {recent ? (
          <span className="citation-search-badge recent">
            <Clock3 size={11} aria-hidden="true" /> recent
          </span>
        ) : null}
        {cited ? <span className="citation-search-cited">cited</span> : null}
        {fits ? (
          <span className="citation-search-badge fits">
            <Check size={11} aria-hidden="true" /> fits
          </span>
        ) : null}
        {suggested && !fits ? (
          <span className="citation-search-badge suggested">
            <TextQuote size={11} aria-hidden="true" /> related
          </span>
        ) : null}
      </div>
      {entry.title ? <strong>{entry.title}</strong> : null}
      {meta ? <small>{meta}</small> : null}
    </>
  );
}

function PaperRow({
  paper,
  existing,
}: {
  paper: ScholarlyPaper;
  existing?: CitationEntry;
}) {
  const authors =
    paper.authors.length > 3
      ? `${paper.authors.slice(0, 3).join(", ")} et al.`
      : paper.authors.join(", ");
  const meta = [authors, paper.year, paper.venue].filter(Boolean).join(" · ");
  return (
    <>
      <div className="citation-search-row-top">
        <span className="citation-search-badge online">
          <Globe size={11} aria-hidden="true" /> {paper.provider}
        </span>
        {existing ? (
          <span className="citation-search-cited">in library</span>
        ) : (
          <span className="citation-search-badge add">＋ new entry</span>
        )}
        {paper.citationCount ? (
          <span className="citation-search-badge">
            {paper.citationCount.toLocaleString()} citations
          </span>
        ) : null}
      </div>
      <strong>{paper.title}</strong>
      {meta ? <small>{meta}</small> : null}
    </>
  );
}
