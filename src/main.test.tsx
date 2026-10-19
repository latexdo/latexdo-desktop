import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  createRoot: vi.fn(),
  installBrowserApis: vi.fn(),
  installRendererDiagnostics: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: (el: Element) => {
    mocks.createRoot(el);
    return { render: mocks.render };
  },
}));
vi.mock("../build/icon.svg", () => ({ default: "/icon.svg" }));
vi.mock("./App", () => ({ default: () => null }));
vi.mock("./browserApi", () => ({ installBrowserApis: mocks.installBrowserApis }));
vi.mock("./rendererDiagnostics", () => ({
  installRendererDiagnostics: mocks.installRendererDiagnostics,
}));
vi.mock("./collaboration/CollaborationProvider", () => ({
  CollaborationProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("./RendererErrorBoundary", () => ({
  RendererErrorBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock("./styles/tokens.css", () => ({}));
vi.mock("./styles.css", () => ({}));

describe("renderer entry point", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
  });
  afterEach(() => vi.restoreAllMocks());

  it("adds a favicon, installs APIs and renders into #root", async () => {
    await import("./main");
    const icon = document.head.querySelector<HTMLLinkElement>("link[rel='icon']");
    expect(icon?.type).toBe("image/svg+xml");
    expect(icon?.getAttribute("href")).toBe("/icon.svg");
    expect(mocks.installBrowserApis).toHaveBeenCalledTimes(1);
    expect(mocks.installRendererDiagnostics).toHaveBeenCalledTimes(1);
    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing favicon link and snaps window scroll back", async () => {
    const existing = document.createElement("link");
    existing.rel = "icon";
    document.head.appendChild(existing);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await import("./main");
    expect(document.head.querySelectorAll("link[rel='icon']")).toHaveLength(1);
    expect(existing.getAttribute("href")).toBe("/icon.svg");

    window.dispatchEvent(new Event("scroll"));
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 10 });
    window.dispatchEvent(new Event("scroll"));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });
});
