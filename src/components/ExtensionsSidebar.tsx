import { ExtensionIcon, ExtensionPreview } from "./ExtensionPreview";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
  Settings,
} from "lucide-react";
import { useState } from "react";
import {
  categoryLabel,
  extensionCategories,
  type ExtensionCategory,
  type LatexDoExtensionCatalog,
  type LatexDoExtensionManifest,
} from "../extensions";

interface ExtensionsSidebarProps {
  catalog: LatexDoExtensionCatalog;
  catalogLoading: boolean;
  catalogError: string;
  query: string;
  onQueryChange: (query: string) => void;
  categoryFilter: ExtensionCategory | "all";
  onCategoryFilterChange: (category: ExtensionCategory | "all") => void;
  installedExtensionIdSet: ReadonlySet<string>;
  filteredExtensions: LatexDoExtensionManifest[];
  onInstallExtension: (extension: LatexDoExtensionManifest) => void;
  /**
   * Opens what an installed extension adds (#225). Returns false when it
   * adds nothing to open, in which case its details are shown.
   */
  onOpenExtension?: (extension: LatexDoExtensionManifest) => boolean;
  /** Opens the extension's details page as an editor tab. */
  onShowDetails: (extension: LatexDoExtensionManifest) => void;
  /** The extension whose details tab is open, highlighted in the list. */
  selectedExtensionId?: string;
}

export function ExtensionsSidebar({
  catalog,
  catalogLoading,
  catalogError,
  query,
  onQueryChange,
  categoryFilter,
  onCategoryFilterChange,
  installedExtensionIdSet,
  filteredExtensions,
  onInstallExtension,
  onOpenExtension,
  onShowDetails,
  selectedExtensionId = "",
}: ExtensionsSidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const installed = filteredExtensions.filter((extension) =>
    installedExtensionIdSet.has(extension.id),
  );
  const available = filteredExtensions.filter(
    (extension) => !installedExtensionIdSet.has(extension.id),
  );
  // An installed extension opens what it adds (#225); everything else, and
  // an extension that adds nothing to open, shows its details page.
  const activate = (extension: LatexDoExtensionManifest) => {
    if (installedExtensionIdSet.has(extension.id) && onOpenExtension?.(extension)) {
      return;
    }
    onShowDetails(extension);
  };
  const toggle = (title: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const section = (title: string, extensions: LatexDoExtensionManifest[]) => {
    const open = !collapsed.has(title);
    return (
      <section className="extensions-section" aria-label={title}>
        <button
          type="button"
          className="extensions-section-header"
          aria-expanded={open}
          onClick={() => toggle(title)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{title}</span>
          <strong>{extensions.length}</strong>
        </button>
        {open
          ? extensions.map((extension) => (
              <ExtensionRow
                key={extension.id}
                extension={extension}
                installed={installedExtensionIdSet.has(extension.id)}
                selected={selectedExtensionId === extension.id}
                onActivate={() => activate(extension)}
                onShowDetails={() => onShowDetails(extension)}
                onInstall={() => onInstallExtension(extension)}
              />
            ))
          : null}
      </section>
    );
  };

  return (
    <div className="sidebar-panel extensions-sidebar-panel">
      <div className="extensions-search-row">
        <label className="extensions-search-box">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search extensions"
            spellCheck={false}
            aria-label="Search extensions"
          />
        </label>
        <select
          value={categoryFilter}
          onChange={(event) =>
            onCategoryFilterChange(event.target.value as ExtensionCategory | "all")
          }
          aria-label="Filter extensions by category"
          title="Category"
        >
          <option value="all">All</option>
          {extensionCategories.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </div>

      {catalogError ? (
        <div className="extension-store-alert extensions-alert">
          <AlertCircle size={14} />
          <span>{catalogError}</span>
        </div>
      ) : null}

      <div className="extensions-list">
        {filteredExtensions.length ? (
          <>
            {installed.length ? section("Installed", installed) : null}
            {available.length
              ? section(installed.length ? "Recommended" : "Available", available)
              : null}
          </>
        ) : (
          <div className="extensions-empty">
            {catalog.extensions.length
              ? "No extensions match your search."
              : "No extensions available."}
          </div>
        )}
      </div>

      {catalogLoading ? (
        <div className="extensions-refreshing" role="status">
          Refreshing…
        </div>
      ) : null}
    </div>
  );
}

interface ExtensionRowProps {
  extension: LatexDoExtensionManifest;
  installed: boolean;
  selected: boolean;
  onActivate: () => void;
  onShowDetails: () => void;
  onInstall: () => void;
}

/** One dense row: icon, name and version, one-line description, author. */
function ExtensionRow({
  extension,
  installed,
  selected,
  onActivate,
  onShowDetails,
  onInstall,
}: ExtensionRowProps) {
  return (
    <article className={`extension-row ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="extension-row-main"
        onClick={onActivate}
        aria-label={
          installed ? `Open ${extension.name}` : `View ${extension.name} details`
        }
        title={extension.description}
      >
        <span className="extension-row-icon" aria-hidden="true">
          <ExtensionIcon extension={extension} />
        </span>
        <span className="extension-row-text">
          <span className="extension-row-title">
            <strong>{extension.name}</strong>
            <small>v{extension.version}</small>
          </span>
          <span className="extension-row-description">{extension.description}</span>
          <span className="extension-row-author">{extension.author}</span>
        </span>
      </button>
      <div className="extension-row-actions">
        {installed ? (
          <button
            type="button"
            className="small-icon"
            onClick={onShowDetails}
            aria-label={`View ${extension.name} details`}
            title="Details"
          >
            <Settings size={14} />
          </button>
        ) : (
          <button type="button" className="extension-install" onClick={onInstall}>
            Install
          </button>
        )}
      </div>
    </article>
  );
}

interface ExtensionDetailPanelProps {
  extension: LatexDoExtensionManifest;
  installed: boolean;
  onInstallExtension: (extension: LatexDoExtensionManifest) => void;
  onUninstallExtension: (extension: LatexDoExtensionManifest) => void;
  onOpenExternal: (url: string) => void;
}

function isStoreWebsite(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    return (
      host === "store.latexdo.org" ||
      (host === "latexdo.org" && /^\/store(\/|$)/.test(pathname))
    );
  } catch {
    return false;
  }
}

export function ExtensionDetailPanel({
  extension,
  installed,
  onInstallExtension,
  onUninstallExtension,
  onOpenExternal,
}: ExtensionDetailPanelProps) {
  const featureFlags = Object.keys(extension.contributes.featureFlags ?? {});
  const snippets = extension.contributes.snippets ?? [];
  const templates = extension.contributes.templates ?? [];
  // A homepage on the store website only repeats this page; extensions are
  // browsed and installed inside the app.
  const homepage =
    extension.homepage && !isStoreWebsite(extension.homepage)
      ? extension.homepage
      : undefined;

  return (
    <section className="extension-page" role="region" aria-label="Extension details">
      <header className="extension-page-header">
        <div className="extension-page-icon" aria-hidden="true">
          <ExtensionIcon extension={extension} size={40} />
        </div>
        <div className="extension-page-heading">
          <h1>{extension.name}</h1>
          <p className="extension-page-byline">
            <span>{extension.author}</span>
            <span>v{extension.version}</span>
            <span>{categoryLabel(extension.category)}</span>
          </p>
          <p className="extension-page-description">{extension.description}</p>
          <div className="extension-page-actions">
            <button
              type="button"
              className={installed ? "dialog-cancel" : "dialog-submit"}
              onClick={() =>
                installed
                  ? onUninstallExtension(extension)
                  : onInstallExtension(extension)
              }
            >
              {installed ? "Uninstall" : "Install"}
            </button>
            {installed ? (
              <span className="extension-page-installed">
                <Check size={13} /> Installed
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="extension-page-body">
        <div className="extension-page-main">
          <ExtensionPreview extension={extension} />
          {extension.screenshots?.length ? (
            <div className="extension-screenshots" aria-label="Screenshots">
              {extension.screenshots.map((shot) => (
                <figure key={shot.url}>
                  <img
                    src={shot.url}
                    alt={shot.caption ?? `${extension.name} screenshot`}
                    loading="lazy"
                  />
                  {shot.caption ? <figcaption>{shot.caption}</figcaption> : null}
                </figure>
              ))}
            </div>
          ) : null}
          <h2>What it adds</h2>
          {featureFlags.length ? (
            <ul>
              {featureFlags.map((flag) => (
                <li key={flag}>{formatFeatureFlagName(flag)}</li>
              ))}
            </ul>
          ) : null}
          {snippets.length ? (
            <>
              <h3>Snippets</h3>
              <ul>
                {snippets.map((snippet) => (
                  <li key={snippet.label}>
                    <code>{snippet.label}</code>
                    {snippet.detail ? <span> — {snippet.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {templates.length ? (
            <>
              <h3>Templates</h3>
              <ul>
                {templates.map((template) => (
                  <li key={template.id}>
                    <strong>{template.name}</strong>
                    <span> — {template.summary}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {!featureFlags.length && !snippets.length && !templates.length ? (
            <p>This extension only adds metadata.</p>
          ) : null}
        </div>

        <aside className="extension-page-aside">
          <h2>Details</h2>
          <dl>
            <dt>Identifier</dt>
            <dd>{extension.id}</dd>
            <dt>Version</dt>
            <dd>{extension.version}</dd>
            <dt>Type</dt>
            <dd>{extension.kind === "template" ? "Template pack" : "Extension"}</dd>
          </dl>
          {homepage || extension.repository ? (
            <>
              <h2>Links</h2>
              <div className="extension-page-links">
                {homepage ? (
                  <button type="button" onClick={() => onOpenExternal(homepage)}>
                    Homepage <ExternalLink size={12} />
                  </button>
                ) : null}
                {extension.repository ? (
                  <button
                    type="button"
                    onClick={() => onOpenExternal(extension.repository!)}
                  >
                    Repository <ExternalLink size={12} />
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          {extension.tags.length ? (
            <>
              <h2>Tags</h2>
              <div className="extension-page-tags" aria-label="Tags">
                {extension.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

const featureFlagNames: Record<string, string> = {
  tikzConverterEnabled:
    "The Figure → TikZ Converter tool, in the activity bar and Tools menu",
  tableGeneratorEnabled: "The Table Generator tool",
  notationManagerEnabled: "The Notation Manager tool",
};

function formatFeatureFlagName(flag: string): string {
  if (featureFlagNames[flag]) return featureFlagNames[flag];
  return flag
    .replace(/Enabled$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
