import React from "react";
import { Search, Settings, X } from "lucide-react";

/*
 * The Settings window, laid out like an editor's settings page: a search box
 * across the top, the categories on the left and the chosen category's
 * settings on the right. Searching shows every category at once and keeps only
 * the settings whose text matches.
 */

export interface SettingsPage {
  id: string;
  title: string;
  /** The heading this page is listed under in the category list. */
  group: string;
  content: React.ReactNode;
}

interface SettingsShellProps {
  pages: SettingsPage[];
  activePage: string;
  onSelectPage: (id: string) => void;
  onClose: () => void;
  footer?: React.ReactNode;
}

/** Elements that start a group of settings inside a page. */
const headingSelector = ".settings-section-heading";

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Everything a person could search a block by: its text and control labels. */
function searchableText(element: Element): string {
  const labels = [...element.querySelectorAll("[aria-label], [title], option")]
    .map(
      (node) =>
        `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""} ${
          node.tagName === "OPTION" ? (node.textContent ?? "") : ""
        }`,
    )
    .join(" ");
  return normalize(`${element.textContent ?? ""} ${labels}`);
}

/**
 * The element whose children are a page's settings. A page that wraps all its
 * settings in one element is looked into.
 */
function blockContainer(page: Element): Element {
  let container = page.querySelector(":scope > .settings-page-body") ?? page;
  while (
    container.children.length === 1 &&
    !container.firstElementChild!.matches(headingSelector)
  ) {
    container = container.firstElementChild!;
  }
  return container;
}

/**
 * Hides the settings of every rendered page that do not contain all the words
 * of the query, and returns how many settings matched in each page. A heading
 * that matches keeps its whole group.
 */
export function filterSettings(root: HTMLElement, query: string): Map<string, number> {
  const words = normalize(query).split(" ").filter(Boolean);
  const matches = new Map<string, number>();
  let firstVisible = true;
  for (const page of root.querySelectorAll<HTMLElement>("[data-settings-page]")) {
    const id = page.dataset.settingsPage!;
    const blocks = [...blockContainer(page).children] as HTMLElement[];
    let count = 0;
    let heading: HTMLElement | null = null;
    let headingMatches = false;
    let groupVisible = false;
    const closeGroup = () => {
      if (heading) heading.hidden = words.length > 0 && !groupVisible;
    };
    for (const block of blocks) {
      if (block.matches(headingSelector)) {
        closeGroup();
        heading = block;
        const text = searchableText(block);
        headingMatches = words.length > 0 && words.every((word) => text.includes(word));
        groupVisible = headingMatches;
        continue;
      }
      const text = searchableText(block);
      const visible =
        words.length === 0 ||
        headingMatches ||
        words.every((word) => text.includes(word));
      block.hidden = !visible;
      if (visible) {
        groupVisible = true;
        count += 1;
      }
    }
    closeGroup();
    page.hidden = words.length > 0 && count === 0;
    // Only pages after the first one shown get a divider above them.
    page.toggleAttribute("data-follows-page", !page.hidden && !firstVisible);
    if (!page.hidden) firstVisible = false;
    matches.set(id, count);
  }
  return matches;
}

export const SettingsShell: React.FC<SettingsShellProps> = ({
  pages,
  activePage,
  onSelectPage,
  onClose,
  footer,
}) => {
  const [query, setQuery] = React.useState("");
  const [matches, setMatches] = React.useState<Map<string, number>>(new Map());
  const listRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  const current = pages.find((page) => page.id === activePage) ?? pages[0];

  // Re-applied after every render: settings appear and disappear as options
  // change, and React re-creates their elements without the hidden flag.
  React.useLayoutEffect(() => {
    if (!listRef.current) return;
    const next = filterSettings(listRef.current, query);
    setMatches((previous) => {
      if (
        previous.size === next.size &&
        [...next].every(([id, count]) => previous.get(id) === count)
      ) {
        return previous;
      }
      return next;
    });
  });

  // ⌘F / Ctrl+F jumps to the search box, as in other editors.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const totalMatches = searching
    ? pages.reduce((sum, page) => sum + (matches.get(page.id) ?? 0), 0)
    : 0;
  const groups = pages.reduce<{ name: string; pages: SettingsPage[] }[]>(
    (all, page) => {
      const group = all.find((entry) => entry.name === page.group);
      if (group) group.pages.push(page);
      else all.push({ name: page.group, pages: [page] });
      return all;
    },
    [],
  );
  const shownPages = searching ? pages : current ? [current] : [];

  const choosePage = (id: string) => {
    if (searching) {
      listRef.current
        ?.querySelector(`[data-settings-page="${id}"]`)
        ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      return;
    }
    onSelectPage(id);
    listRef.current?.scrollTo?.({ top: 0 });
  };

  return (
    <section
      className="settings-dialog settings-shell"
      role="dialog"
      aria-modal="false"
      aria-labelledby="settings-title"
    >
      <div className="settings-header">
        <div className="dialog-icon">
          <Settings size={20} />
        </div>
        <div className="dialog-copy">
          <h2 id="settings-title">Settings</h2>
        </div>
        <button
          type="button"
          className="settings-close"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X size={17} />
        </button>
      </div>

      <div className="settings-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search settings"
          aria-label="Search settings"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {searching ? (
          <span className="settings-search-count" role="status">
            {totalMatches === 1 ? "1 setting found" : `${totalMatches} settings found`}
          </span>
        ) : null}
      </div>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings categories">
          {groups.map((group) => (
            <div key={group.name} className="settings-nav-group">
              <div className="settings-nav-group-title">{group.name}</div>
              {group.pages.map((page) => {
                const count = matches.get(page.id) ?? 0;
                const dimmed = searching && count === 0;
                return (
                  <button
                    key={page.id}
                    type="button"
                    className={`settings-tab settings-nav-item ${
                      !searching && page.id === current?.id ? "active" : ""
                    } ${dimmed ? "dimmed" : ""}`}
                    aria-current={
                      !searching && page.id === current?.id ? "page" : undefined
                    }
                    disabled={dimmed}
                    onClick={() => choosePage(page.id)}
                  >
                    <span>{page.title}</span>
                    {searching && count > 0 ? (
                      <span className="settings-nav-count">{count}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="settings-list" ref={listRef}>
          {shownPages.map((page) => (
            <section
              key={page.id}
              className="settings-page"
              data-settings-page={page.id}
              aria-label={page.title}
            >
              <h1 className="settings-page-title">{page.title}</h1>
              <div className="settings-page-body">{page.content}</div>
            </section>
          ))}
          {searching && totalMatches === 0 ? (
            <p className="settings-no-results">
              No settings match “{query.trim()}”. Try another word.
            </p>
          ) : null}
        </div>
      </div>

      {footer}
    </section>
  );
};
