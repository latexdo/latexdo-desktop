/*
 * "Open in LatexDo": hands a web invite to the desktop app through its
 * latexdo-app:// link (registered by the installed app, see
 * electron/deepLink.ts). Browsers do not let a page ask whether an app is
 * installed, so the page tries to open it and watches whether the browser
 * lets go of the page (the app, or the browser's "Open LatexDo?" prompt,
 * takes focus). Once that has worked, it is remembered for next time.
 */

export const appScheme = "latexdo-app";
export const downloadPageUrl = "https://latexdo.org/downloads/";
const appSeenStorageKey = "latexdo-app-opened";
const browserChoiceStorageKey = "latexdo-open-in-browser";

/** The invite code from a join link's "#" part, as the app's link carries it. */
export function inviteCodeFromHash(hash: string): string | null {
  let code = hash.replace(/\s+/g, "").replace(/^#/, "");
  if (code.startsWith("latexdo-invite:")) code = code.slice("latexdo-invite:".length);
  return code && code.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(code) ? code : null;
}

export function appLinkForCode(code: string): string {
  return `${appScheme}://join/${code}`;
}

/** Phones and tablets have no LatexDo app: they go straight to the editor. */
export function isDesktopBrowser(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(userAgent)) return false;
  // iPadOS presents itself as a Mac; a Mac has no touch screen.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return false;
  return true;
}

/**
 * Firefox shows an error page for an unknown scheme at the top level, but
 * launches the app from a hidden frame. Chromium and Safari ignore a frame:
 * they only open the app (after asking "Open LatexDo?") for a top-level link.
 */
function opensFromHiddenFrame(userAgent: string): boolean {
  return /Firefox\//.test(userAgent);
}

/**
 * Long enough to answer the browser's "Open LatexDo?" question: the page
 * keeps focus while it is shown, so a short wait reads a slow "Allow" as
 * "not installed".
 */
export const appOpenTimeoutMs = 8000;

export interface LaunchEnvironment {
  window: Pick<
    Window,
    "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout"
  >;
  document: Pick<
    Document,
    | "addEventListener"
    | "removeEventListener"
    | "visibilityState"
    | "createElement"
    | "body"
  >;
  navigate: (url: string) => void;
  userAgent: string;
}

function browserEnvironment(): LaunchEnvironment {
  return {
    window,
    document,
    navigate: (url) => {
      window.location.href = url;
    },
    userAgent: navigator.userAgent,
  };
}

/**
 * Tries to open the app. Resolves true when the page loses focus or is
 * hidden soon after (the app or the browser's prompt opened), false when
 * nothing happened, which usually means LatexDo is not installed.
 */
export function tryOpenApp(
  url: string,
  timeoutMs = appOpenTimeoutMs,
  env: LaunchEnvironment = browserEnvironment(),
): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    let frame: HTMLIFrameElement | null = null;
    const finish = (opened: boolean) => {
      if (finished) return;
      finished = true;
      env.window.clearTimeout(timer);
      env.window.removeEventListener("blur", onLeave);
      env.window.removeEventListener("pagehide", onLeave);
      env.document.removeEventListener("visibilitychange", onVisibility);
      // Leave the frame a moment: removing it can cancel the hand-off.
      if (frame) {
        const stale = frame;
        env.window.setTimeout(() => stale.remove(), 1000);
      }
      resolve(opened);
    };
    const onLeave = () => finish(true);
    const onVisibility = () => {
      if (env.document.visibilityState === "hidden") finish(true);
    };
    env.window.addEventListener("blur", onLeave);
    env.window.addEventListener("pagehide", onLeave);
    env.document.addEventListener("visibilitychange", onVisibility);
    const timer = env.window.setTimeout(() => finish(false), timeoutMs);
    if (opensFromHiddenFrame(env.userAgent)) {
      frame = env.document.createElement("iframe");
      frame.hidden = true;
      frame.src = url;
      env.document.body.append(frame);
    } else {
      env.navigate(url);
    }
  });
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Private windows may refuse storage; the page still works.
  }
}

/** LatexDo opened from this browser before: it is installed here. */
export function appSeenBefore(): boolean {
  return read(() => localStorage, appSeenStorageKey) === "1";
}

export function rememberAppOpened(): void {
  write(() => localStorage, appSeenStorageKey, "1");
}

/** Chose the browser editor in this tab: a reload must not ask again. */
export function choseBrowser(): boolean {
  return read(() => sessionStorage, browserChoiceStorageKey) === "1";
}

export function rememberBrowserChoice(chosen: boolean): void {
  write(() => sessionStorage, browserChoiceStorageKey, chosen ? "1" : null);
}
