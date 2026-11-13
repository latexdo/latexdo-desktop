import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appLinkForCode,
  appSeenBefore,
  choseBrowser,
  inviteCodeFromHash,
  isDesktopBrowser,
  rememberAppOpened,
  rememberBrowserChoice,
  tryOpenApp,
  type LaunchEnvironment,
} from "./appLink";

const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const firefox =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const safari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function environment(userAgent: string) {
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  const navigate = vi.fn();
  const env: LaunchEnvironment & { visibilityState: DocumentVisibilityState } = {
    visibilityState: "visible",
    window: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      setTimeout: ((handler: () => void, ms: number) =>
        setTimeout(handler, ms)) as unknown as Window["setTimeout"],
      clearTimeout: ((id: number) => clearTimeout(id)) as Window["clearTimeout"],
    },
    document: {
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
      get visibilityState() {
        return env.visibilityState;
      },
      createElement: document.createElement.bind(document),
      body: document.body,
    } as LaunchEnvironment["document"],
    navigate,
    userAgent,
  };
  return { env, events, documentEvents, navigate };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  document.body.replaceChildren();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("join link helpers", () => {
  it("reads the invite code and builds the app link", () => {
    expect(inviteCodeFromHash("#abc_DEF-1")).toBe("abc_DEF-1");
    expect(inviteCodeFromHash("#latexdo-invite:abc")).toBe("abc");
    expect(inviteCodeFromHash("#bad code!")).toBeNull();
    expect(inviteCodeFromHash("")).toBeNull();
    expect(appLinkForCode("abc")).toBe("latexdo-app://join/abc");
  });

  it("offers the app only on computers", () => {
    expect(isDesktopBrowser(chrome)).toBe(true);
    expect(isDesktopBrowser(firefox)).toBe(true);
    expect(
      isDesktopBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      ),
    ).toBe(false);
    expect(
      isDesktopBrowser(
        "Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537.36",
      ),
    ).toBe(false);
    // iPadOS says it is a Mac, but has a touch screen.
    expect(isDesktopBrowser(safari, 5)).toBe(false);
    expect(isDesktopBrowser(safari, 0)).toBe(true);
  });

  it("remembers that the app opened here, and a browser choice for this tab", () => {
    expect(appSeenBefore()).toBe(false);
    rememberAppOpened();
    expect(appSeenBefore()).toBe(true);
    expect(choseBrowser()).toBe(false);
    rememberBrowserChoice(true);
    expect(choseBrowser()).toBe(true);
    rememberBrowserChoice(false);
    expect(choseBrowser()).toBe(false);
  });
});

describe("tryOpenApp", () => {
  it("in Chromium, navigates and reports the app opened when the page loses focus", async () => {
    const { env, events, navigate } = environment(chrome);
    const result = tryOpenApp("latexdo-app://join/abc", 2500, env);
    expect(navigate).toHaveBeenCalledWith("latexdo-app://join/abc");
    events.dispatchEvent(new Event("blur"));
    await expect(result).resolves.toBe(true);
  });

  it("reports the page being hidden as opened too", async () => {
    const { env, documentEvents } = environment(chrome);
    const result = tryOpenApp("latexdo-app://join/abc", 2500, env);
    env.visibilityState = "hidden";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    await expect(result).resolves.toBe(true);
  });

  it("reports not installed when nothing happens in time", async () => {
    const { env } = environment(chrome);
    const result = tryOpenApp("latexdo-app://join/abc", 2500, env);
    vi.advanceTimersByTime(2500);
    await expect(result).resolves.toBe(false);
  });

  it.each([firefox, safari])(
    "uses a hidden frame elsewhere, so a missing app shows no error page (%#)",
    async (userAgent) => {
      const { env, navigate } = environment(userAgent);
      const result = tryOpenApp("latexdo-app://join/abc", 2500, env);
      expect(navigate).not.toHaveBeenCalled();
      const frame = document.body.querySelector("iframe")!;
      expect(frame.hidden).toBe(true);
      expect(frame.getAttribute("src")).toBe("latexdo-app://join/abc");
      vi.advanceTimersByTime(2500);
      await expect(result).resolves.toBe(false);
      vi.advanceTimersByTime(1000);
      expect(document.body.querySelector("iframe")).toBeNull();
    },
  );
});
