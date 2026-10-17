import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fallbackExtensionCatalog, type LatexDoExtensionManifest } from "../extensions";
import { ExtensionDetailPanel, ExtensionsSidebar } from "./ExtensionsSidebar";

const extensions = fallbackExtensionCatalog.extensions;
const tikz = extensions.find((extension) => extension.id === "latexdo.plots")!;

function renderSidebar(onOpenExtension = vi.fn(() => true)) {
  const onShowDetails = vi.fn();
  render(
    <ExtensionsSidebar
      catalog={fallbackExtensionCatalog}
      catalogLoading={false}
      catalogError=""
      query=""
      onQueryChange={vi.fn()}
      categoryFilter="all"
      onCategoryFilterChange={vi.fn()}
      installedExtensionIdSet={new Set([tikz.id])}
      filteredExtensions={extensions}
      onInstallExtension={vi.fn()}
      onOpenExtension={onOpenExtension}
      onShowDetails={onShowDetails}
    />,
  );
  return { onOpenExtension, onShowDetails };
}

describe("ExtensionsSidebar", () => {
  it("opens an installed extension itself when it is clicked (#225)", () => {
    const { onOpenExtension, onShowDetails } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: `Open ${tikz.name}` }));
    expect(onOpenExtension).toHaveBeenCalledWith(tikz);
    expect(onShowDetails).not.toHaveBeenCalled();
  });

  it("keeps the details one click away", () => {
    const { onShowDetails } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: `View ${tikz.name} details` }));
    expect(onShowDetails).toHaveBeenCalledWith(tikz);
  });

  it("shows details when an installed extension has nothing to open", () => {
    const { onShowDetails } = renderSidebar(vi.fn(() => false));
    fireEvent.click(screen.getByRole("button", { name: `Open ${tikz.name}` }));
    expect(onShowDetails).toHaveBeenCalledWith(tikz);
  });

  it("opens details for an extension that is not installed", () => {
    const { onShowDetails } = renderSidebar();
    const other = extensions.find((extension) => extension.id !== tikz.id)!;
    fireEvent.click(screen.getByRole("button", { name: `View ${other.name} details` }));
    expect(onShowDetails).toHaveBeenCalledWith(other);
  });
});

describe("ExtensionDetailPanel links", () => {
  it("never sends people to the store website, but keeps other links", () => {
    const onOpenExternal = vi.fn();
    const manifest = (homepage: string) =>
      ({
        schemaVersion: 1,
        id: "latexdo.figure-to-tikz",
        kind: "extension",
        name: "Figure → TikZ Converter",
        version: "1.0.0",
        description: "Converter",
        author: "LatexDo",
        category: "graphics",
        tags: [],
        homepage,
        repository: "https://github.com/latexdo/latexdo.org",
        contributes: { featureFlags: { tikzConverterEnabled: true } },
      }) as LatexDoExtensionManifest;

    const { rerender } = render(
      <ExtensionDetailPanel
        extension={manifest(
          "https://latexdo.org/store/extensions/latexdo.figure-to-tikz/",
        )}
        installed={false}
        onInstallExtension={vi.fn()}
        onUninstallExtension={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );
    expect(screen.queryByRole("button", { name: /Homepage/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Repository/ })).toBeVisible();

    rerender(
      <ExtensionDetailPanel
        extension={manifest("https://store.latexdo.org/x")}
        installed={false}
        onInstallExtension={vi.fn()}
        onUninstallExtension={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );
    expect(screen.queryByRole("button", { name: /Homepage/ })).not.toBeInTheDocument();

    rerender(
      <ExtensionDetailPanel
        extension={manifest("https://example.org/tool")}
        installed={false}
        onInstallExtension={vi.fn()}
        onUninstallExtension={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Homepage/ }));
    expect(onOpenExternal).toHaveBeenCalledWith("https://example.org/tool");
  });
});
