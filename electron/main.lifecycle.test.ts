// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// Startup, window lifecycle and failure handling of the Electron main process,
// booted repeatedly under different platforms, arguments and environments.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bootMain,
  fakeChild,
  fastTimers,
  H,
  teardownMain,
} from "./__tests__/mainHarness.js";

vi.mock("electron", async () =>
  (await import("./__tests__/mainHarness.js")).electronModule(),
);
vi.mock("./terminal.js", async () =>
  (await import("./__tests__/mainMocks.js")).terminalMock(),
);
vi.mock("./peerCollabIpc.js", async () =>
  (await import("./__tests__/mainMocks.js")).peerCollabMock(),
);
vi.mock("./buildInfo.js", async () =>
  (await import("./__tests__/mainMocks.js")).buildInfoMock(),
);
vi.mock("./ai/aiIpc.js", async () =>
  (await import("./__tests__/mainMocks.js")).aiIpcMock(),
);
vi.mock("./voiceStt.js", async () =>
  (await import("./__tests__/mainMocks.js")).voiceMock(),
);
vi.mock("./compiler.js", async (importOriginal) =>
  (await import("./__tests__/mainMocks.js")).compilerMock(await importOriginal()),
);
vi.mock("./docxImport.js", async () =>
  (await import("./__tests__/mainMocks.js")).docxMock(),
);
vi.mock("./pdfImport/index.js", async () =>
  (await import("./__tests__/mainMocks.js")).pdfImportMock(),
);
vi.mock("./synctex.js", async () =>
  (await import("./__tests__/mainMocks.js")).synctexMock(),
);
vi.mock("./orcid.js", async (importOriginal) =>
  (await import("./__tests__/mainMocks.js")).orcidMock(await importOriginal()),
);
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapChildProcess(
    await importOriginal(),
  ),
);
vi.mock("node:fs", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapFs(await importOriginal()),
);
vi.mock("node:fs/promises", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapFsPromises(await importOriginal()),
);
vi.mock("./git.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapGit(await importOriginal()),
);
vi.mock("./diagnostics.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).wrapDiagnostics(await importOriginal()),
);
vi.mock("./updatePending.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).overridable(
    await importOriginal<typeof import("./updatePending.js")>(),
    "pending",
    ["resolvePendingUpdate", "pendingUpdateAttemptLimitReached"],
  ),
);
vi.mock("./updateExperience.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).overridable(
    await importOriginal<typeof import("./updateExperience.js")>(),
    "experience",
    ["recordConfirmedUpdate", "recordLaunchedVersion"],
  ),
);
vi.mock("./releaseNotes.js", async (importOriginal) =>
  (await import("./__tests__/mainWrappers.js")).overridable(
    await importOriginal<typeof import("./releaseNotes.js")>(),
    "releaseNotes",
    ["resolveReleaseNotes", "resolveReleaseNotesRange"],
  ),
);

afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await teardownMain();
});

const crashed = (reason: string, exitCode = 1) => ({ reason, exitCode });

describe("main process startup", () => {
  it("boots a sandboxed window and asks for privacy consent until accepted", async () => {
    const boot = await bootMain({
      consent: false,
      before: () => {
        H.message
          .mockResolvedValueOnce({ response: 1 })
          .mockResolvedValueOnce({ response: 0 });
      },
    });
    await vi.waitFor(() => expect(H.message).toHaveBeenCalledTimes(2));
    expect(H.external).toHaveBeenCalledWith("https://www.latexdo.org/privacy");
    await vi.waitFor(async () =>
      expect(
        JSON.parse(
          await readFile(path.join(boot.profile, "privacy-consent.json"), "utf8"),
        ),
      ).toMatchObject({ schemaVersion: 1, appVersion: "0.3.0" }),
    );
    expect(boot.window.options.webPreferences).toMatchObject({ sandbox: true });
    expect(boot.window.options.title).toBe("LatexDo");
    expect(H.dockSetIcon).toHaveBeenCalled();
    expect(H.protocol).toHaveBeenCalledWith("latexdo", expect.any(Function));
    expect(H.quit).not.toHaveBeenCalled();
    expect(boot.window.webContents.windowOpenHandler?.()).toEqual({ action: "deny" });
  });

  it("quits when privacy consent is declined", async () => {
    await bootMain({
      consent: false,
      before: () => {
        H.message.mockResolvedValueOnce({ response: 2 });
      },
    });
    await vi.waitFor(() => expect(H.quit).toHaveBeenCalledOnce());
    expect(H.appEvents.has("activate")).toBe(false);
  });

  it("reopens a window on activate only when none is left", async () => {
    const boot = await bootMain();
    await vi.waitFor(() => expect(H.appEvents.has("activate")).toBe(true));
    boot.appEvent("activate");
    expect(H.createdWindows).toHaveLength(1);
    boot.window.destroy();
    boot.appEvent("activate");
    expect(H.createdWindows).toHaveLength(2);
  });

  it("keeps the app alive without windows on macOS only", async () => {
    let boot = await bootMain({ platform: "darwin" });
    boot.appEvent("window-all-closed");
    expect(H.quit).not.toHaveBeenCalled();
    boot = await bootMain({ platform: "linux" });
    boot.appEvent("window-all-closed");
    expect(H.quit).toHaveBeenCalledOnce();
  });

  it("exits at once for an update version probe and a second instance", async () => {
    await bootMain({ argv: ["--latexdo-verify-update", "9.9.9"] });
    expect(H.exit.mock.calls[0]).toEqual([1]);
    await bootMain({ lock: false });
    expect(H.exit).toHaveBeenCalledWith(0);
  });

  it("uses the development server, profile and runtime cache settings", async () => {
    const boot = await bootMain({
      env: {
        VITE_DEV_SERVER_URL: "http://localhost:5173/",
        LATEXDO_DEV_USER_DATA: "dev-profile",
        LATEXDO_DEV_CLEAR_RUNTIME_CACHE: "1",
      },
      before: async ({ profile }) => {
        await mkdir(path.join(profile, "models", "llm"), { recursive: true });
        await mkdir(path.join(profile, "speech"), { recursive: true });
      },
    });
    expect(H.setPath).toHaveBeenCalledWith("userData", path.resolve("dev-profile"));
    expect(boot.window.loadURL).toHaveBeenCalledWith("http://localhost:5173/");
    expect(H.protocol).not.toHaveBeenCalled();
    await expect(readFile(path.join(boot.profile, "models"))).rejects.toThrow();
    await expect(readFile(path.join(boot.profile, "speech"))).rejects.toThrow();
    // The development renderer is trusted for IPC.
    expect(await boot.call("app:menu-shortcuts")).toEqual(expect.any(Array));
  });

  it("names the product after the edition and configured endpoints", async () => {
    let boot = await bootMain({ env: { LATEXDO_EDITION: "pro" } });
    expect(boot.window.options.title).toBe("LatexDo Pro");
    boot = await bootMain({
      env: {
        LATEXDO_PRODUCT_NAME: "Campus TeX",
        LATEXDO_PRIVACY_URL: "https://privacy.example.edu/latexdo",
        LATEXDO_DOWNLOADS_URL: "https://downloads.example.edu/latexdo/",
        LATEXDO_EXTENSION_CATALOG_URL: "https://store.example.edu/catalog.json",
      },
    });
    expect(boot.window.options.title).toBe("Campus TeX");
    // Configured hosts become approved external destinations.
    await boot.call("app:open-external", "https://privacy.example.edu/terms");
    await boot.call("app:open-external", "https://downloads.example.edu/latest");
    expect(H.external).toHaveBeenCalledTimes(2);
    H.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ extensions: [] })));
    expect(await boot.call("extensions:get-catalog")).toEqual({ extensions: [] });
    expect(H.fetch.mock.calls[0][0]).toBe("https://store.example.edu/catalog.json");
  });

  it("ignores an unparsable downloads URL when approving hosts and opening notes", async () => {
    const boot = await bootMain({ env: { LATEXDO_DOWNLOADS_URL: "not a url" } });
    H.overrides["releaseNotes.resolveReleaseNotes"] = async (options: any) => {
      expect(options.baseUrl).toBe("https://latexdo.org/updates/release-notes");
      return null;
    };
    expect(await boot.call("app:whats-new-open-notes")).toEqual({ opened: true });
    expect(H.external).toHaveBeenCalledWith("not a url");
  });
});

describe("pending updates at startup", () => {
  const confirmed = {
    status: "confirmed",
    currentVersion: "0.3.0",
    fromVersion: "0.2.0",
    expectedVersion: "0.3.0",
    completedAt: "2026-01-02T00:00:00.000Z",
  };

  it("records a confirmed update and reports it as the last status", async () => {
    const record = vi.fn();
    const launched = vi.fn();
    const boot = await bootMain({
      buildInfo: {
        commit: "c".repeat(40),
        builtAt: "2026-01-01T00:00:00.000Z",
        changes: [{ commit: "d".repeat(40), subject: "Fix" }],
      },
      before: () => {
        H.overrides["pending.resolvePendingUpdate"] = async () => confirmed;
        H.overrides["experience.recordConfirmedUpdate"] = record;
        H.overrides["experience.recordLaunchedVersion"] = launched;
      },
    });
    await vi.waitFor(() => expect(launched).toHaveBeenCalled());
    expect(record).toHaveBeenCalledWith(boot.profile, {
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      confirmedAt: confirmed.completedAt,
    });
    expect(launched.mock.calls[0][3]).toEqual({
      commit: "c".repeat(40),
      history: ["d".repeat(40)],
      updaterConfirmed: true,
    });
    expect(await boot.call("app:last-update-status")).toEqual(confirmed);
  });

  it.each([
    ["an error", new Error("disk full")],
    ["a non-error value", "disk full"],
  ])(
    "keeps starting when recording the confirmed update throws %s",
    async (_, thrown) => {
      await bootMain({
        before: () => {
          H.overrides["pending.resolvePendingUpdate"] = async () => ({
            ...confirmed,
            completedAt: undefined,
          });
          H.overrides["experience.recordConfirmedUpdate"] = async (
            _dir: string,
            value: any,
          ) => {
            expect(value.confirmedAt).toEqual(expect.any(String));
            throw thrown;
          };
        },
      });
      await vi.waitFor(() => expect(H.handlers.has("latex:compile")).toBe(true));
    },
  );

  it("skips recording a confirmation without a source version and logs failures", async () => {
    const record = vi.fn();
    for (const resolution of [
      { ...confirmed, fromVersion: null },
      { ...confirmed, expectedVersion: "0.9.0" },
      { status: "failed", currentVersion: "0.3.0", expectedVersion: "0.4.0" },
    ]) {
      await bootMain({
        before: () => {
          H.overrides["pending.resolvePendingUpdate"] = async () => resolution;
          H.overrides["experience.recordConfirmedUpdate"] = record;
        },
      });
      await vi.waitFor(() => expect(H.handlers.has("latex:compile")).toBe(true));
    }
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    ["an error", new Error("corrupt record")],
    ["a non-error value", "corrupt record"],
  ])("starts without an update status when resolving throws %s", async (_, thrown) => {
    const boot = await bootMain({
      before: () => {
        H.overrides["pending.resolvePendingUpdate"] = async () => {
          throw thrown;
        };
        H.overrides["experience.recordLaunchedVersion"] = async () => {
          throw thrown;
        };
      },
    });
    await vi.waitFor(() => expect(H.handlers.has("app:last-update-status")).toBe(true));
    expect(await boot.call("app:last-update-status")).toHaveProperty("status");
  });
});

describe("fatal failures", () => {
  it("shows a dialog and exits when startup throws", async () => {
    await bootMain({
      waitForWindow: false,
      before: () => {
        H.registerTerminalIpc.mockImplementationOnce(() => {
          throw new Error("terminal unavailable");
        });
      },
    });
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1));
    expect(H.errorBox.mock.calls[0][0]).toBe("LatexDo could not start");
    expect(H.errorBox.mock.calls[0][1]).toContain("terminal unavailable");
  });

  it("still exits when the error dialog cannot be shown", async () => {
    await bootMain({
      waitForWindow: false,
      before: () => {
        H.registerTerminalIpc.mockImplementationOnce(() => {
          throw new Error("terminal unavailable");
        });
        H.errorBox.mockImplementationOnce(() => {
          throw new Error("no display");
        });
      },
    });
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1));
  });

  it("exits once on an uncaught exception and records rejections", async () => {
    const boot = await bootMain();
    H.diagnosticsFail.logPath = true;
    boot.uncaughtException(new Error("main crashed"));
    expect(H.errorBox).toHaveBeenCalledOnce();
    expect(H.errorBox.mock.calls[0][1]).not.toContain("Diagnostic log");
    expect(H.exit).toHaveBeenCalledWith(1);
    boot.uncaughtException(new Error("again"));
    expect(H.errorBox).toHaveBeenCalledOnce();
    expect(H.exit).toHaveBeenCalledTimes(2);
    H.diagnosticsFail.recordSync = true;
    boot.unhandledRejection(new Error("rejected"));
    expect(H.exit).toHaveBeenCalledTimes(2);
  });

  it("ignores broken pipes on the console and its streams only", async () => {
    let failure: Error | null = null;
    const boot = await bootMain({
      before: () => {
        console.log = () => {
          if (failure) throw failure;
        };
      },
    });
    failure = Object.assign(new Error("pipe closed"), { code: "EPIPE" });
    expect(() => console.log("ignored")).not.toThrow();
    failure = new Error("other");
    expect(() => console.log("rethrown")).toThrow("other");
    failure = null;
    const [stdoutError] = boot.streamErrorHandlers;
    expect(() =>
      stdoutError(Object.assign(new Error("pipe"), { code: "EPIPE" })),
    ).not.toThrow();
    expect(() => stdoutError(new Error("disk"))).toThrow("disk");
    expect(() => stdoutError(null)).toThrow();
  });
});

describe("renderer windows", () => {
  it("retries a failed renderer load or quits on request", async () => {
    let failures = 1;
    const boot = await bootMain({
      before: () => {
        H.loadURL = async (_window, url) => {
          if (url.startsWith("latexdo:") && failures-- > 0) throw new Error("ENOENT");
        };
        H.message.mockResolvedValueOnce({ response: 0 });
      },
    });
    await vi.waitFor(() =>
      expect(
        boot.window.loadURL.mock.calls.filter(([url]: [string]) =>
          url.startsWith("latexdo:"),
        ),
      ).toHaveLength(2),
    );
    expect(
      boot.window.loadURL.mock.calls.some(([url]: [string]) =>
        url.startsWith("data:text/html"),
      ),
    ).toBe(true);

    // A failure page that cannot be shown is recorded; the user then quits.
    H.loadURL = async () => {
      throw new Error("blocked");
    };
    H.diagnosticsFail.record = true;
    H.diagnosticsFail.recordSync = true;
    let answer: (value: unknown) => void = () => undefined;
    H.message.mockClear();
    H.message.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    boot.window.webContents.emit(
      "did-fail-load",
      {},
      -2,
      "failed",
      "latexdo://app/",
      true,
    );
    await vi.waitFor(() => expect(H.message).toHaveBeenCalledTimes(1));
    // While that failure is open a second one is ignored.
    boot.window.webContents.emit(
      "did-fail-load",
      {},
      -2,
      "failed",
      "latexdo://app/",
      true,
    );
    answer({ response: 1 });
    await vi.waitFor(() => expect(H.quit).toHaveBeenCalledOnce());
    expect(H.message).toHaveBeenCalledTimes(1);

    boot.window.destroy();
    boot.window.webContents.emit(
      "did-fail-load",
      {},
      -2,
      "failed",
      "latexdo://app/",
      true,
    );
    expect(H.message).toHaveBeenCalledTimes(1);
  });

  it("quits after a renderer crash when asked and ignores clean exits while quitting", async () => {
    const boot = await bootMain();
    H.message.mockResolvedValueOnce({ response: 1 });
    boot.appEvent(
      "render-process-gone",
      {},
      boot.window.webContents,
      crashed("crashed"),
    );
    await vi.waitFor(() => expect(H.quit).toHaveBeenCalledOnce());

    // A crash of a web contents without a window is only recorded.
    boot.appEvent("render-process-gone", {}, { getURL: () => "x" }, crashed("crashed"));
    boot.appEvent("before-quit");
    boot.window.loadURL.mockClear();
    boot.appEvent(
      "render-process-gone",
      {},
      boot.window.webContents,
      crashed("clean-exit", 0),
    );
    boot.appEvent(
      "render-process-gone",
      {},
      boot.window.webContents,
      crashed("killed"),
    );
    await vi.waitFor(() => expect(boot.window.loadURL).toHaveBeenCalled());
    expect(boot.window.loadURL.mock.calls[0][0]).toMatch(/^data:text\/html/);
    // Closing the last window finishes the quit.
    boot.window.emit("closed");
    expect(H.quit).toHaveBeenCalledTimes(2);
  });

  it("forces a hung window closed but leaves a responsive one alone", async () => {
    const boot = await bootMain();
    // Window creation precedes the asynchronous privacy-consent check.
    // Wait for startup to finish before destroying and reactivating windows.
    await vi.waitFor(() => expect(H.appEvents.has("activate")).toBe(true));
    const window = boot.window;
    window.emit("unresponsive");
    expect(window.destroy).not.toHaveBeenCalled();
    window.emit("close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(window.destroy).toHaveBeenCalledOnce();
    // Already destroyed by the time the deferred close runs.
    window.emit("close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(window.destroy).toHaveBeenCalledOnce();

    boot.appEvent("activate");
    const second = H.windows[0];
    second.emit("close");
    second.emit("unresponsive");
    expect(second.destroy).toHaveBeenCalledOnce();

    boot.appEvent("activate");
    const third = H.windows[0];
    third.emit("unresponsive");
    third.emit("responsive");
    third.emit("close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(third.destroy).not.toHaveBeenCalled();
    boot.appEvent("before-quit");
    third.emit("unresponsive");
    expect(third.destroy).toHaveBeenCalledOnce();
  });

  it("keeps working when the spell checker cannot be initialized", async () => {
    const boot = await bootMain();
    boot.window.webContents.session.setSpellCheckerEnabled.mockImplementation(() => {
      throw new Error("no dictionaries");
    });
    boot.window.webContents.emit("did-finish-load");
    expect(boot.window.webContents.listenerCount("context-menu")).toBe(1);
    await vi.waitFor(() =>
      expect(boot.window.webContents.session.setSpellCheckerEnabled).toHaveBeenCalled(),
    );
  });

  it("builds spelling context menus from what is under the cursor", async () => {
    const boot = await bootMain();
    boot.window.webContents.emit("did-finish-load");
    const contextMenu = (params: Record<string, unknown>) => {
      H.menu.mockClear();
      boot.window.webContents.emit(
        "context-menu",
        {},
        {
          dictionarySuggestions: [],
          misspelledWord: "",
          isEditable: false,
          selectionText: "",
          ...params,
        },
      );
      return H.menu.mock.calls[0]?.[0];
    };
    expect(contextMenu({})).toBeUndefined();
    expect(contextMenu({ dictionarySuggestions: ["one"], selectionText: "x" })).toEqual(
      [
        expect.objectContaining({ label: "one" }),
        { type: "separator" },
        { role: "copy" },
      ],
    );
    const editable = contextMenu({ misspelledWord: "teh", isEditable: true });
    expect(editable[0].label).toBe('Add "teh" to Dictionary');
    expect(editable[1]).toEqual({ type: "separator" });
    expect(contextMenu({ isEditable: true })[0]).toEqual({ role: "undo" });
  });
});

describe("automated release checks", () => {
  const goodPage = {
    title: "LatexDo",
    rootChildCount: 2,
    hasProductText: true,
    origin: "latexdo://app",
  };

  it("passes the startup smoke test once the renderer has loaded", async () => {
    const boot = await bootMain({
      argv: ["--smoke-test"],
      before: () => {
        H.isLoadingMainFrame = true;
        H.executeJavaScript = async () => goodPage;
      },
    });
    expect(H.setPath).toHaveBeenCalledWith(
      "userData",
      path.join(boot.profile, `latexdo-smoke-${process.pid}`),
    );
    await vi.waitFor(() =>
      expect(boot.window.webContents.listenerCount("did-finish-load")).toBe(2),
    );
    boot.window.webContents.emit("did-finish-load");
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(0));
    expect(H.message).not.toHaveBeenCalled();
  });

  it.each([
    ["the page is wrong", { ...goodPage, hasProductText: false }, false],
    ["the page is empty", { ...goodPage, rootChildCount: 0 }, false],
    ["the origin is wrong", { ...goodPage, origin: "file://" }, false],
    ["the title is wrong", { ...goodPage, title: "Other" }, false],
    ["loading fails", goodPage, true],
  ])("fails the smoke test when %s", async (_, page, failLoad) => {
    const boot = await bootMain({
      argv: ["--smoke-test"],
      before: () => {
        H.isLoadingMainFrame = true;
        H.executeJavaScript = async () => page;
      },
    });
    await vi.waitFor(() =>
      expect(boot.window.webContents.listenerCount("did-fail-load")).toBe(2),
    );
    if (failLoad)
      boot.window.webContents.emit("did-fail-load", {}, -6, "gone", "latexdo://app/");
    else boot.window.webContents.emit("did-finish-load");
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1));
    expect(H.exit).not.toHaveBeenCalledWith(0);
  });

  it("fails the smoke test when the renderer never loads", async () => {
    const restore = fastTimers([20_000]);
    try {
      await bootMain({
        argv: ["--smoke-test"],
        before: () => {
          H.isLoadingMainFrame = true;
        },
      });
      await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1));
    } finally {
      restore();
    }
  });

  it("exits instead of prompting when the renderer fails during automation", async () => {
    await bootMain({
      argv: ["--smoke-test"],
      before: () => {
        H.loadURL = async () => {
          throw new Error("missing renderer");
        };
        H.executeJavaScript = () => new Promise(() => undefined);
      },
    });
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1));
    expect(H.message).not.toHaveBeenCalled();

    const boot = await bootMain({
      argv: ["--smoke-test"],
      before: () => {
        H.executeJavaScript = () => new Promise(() => undefined);
      },
    });
    boot.appEvent(
      "render-process-gone",
      {},
      boot.window.webContents,
      crashed("crashed"),
    );
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1));
    H.exit.mockClear();
    boot.appEvent("render-process-gone", {}, { getURL: () => "x" }, crashed("crashed"));
    expect(H.exit).toHaveBeenCalledWith(1);
    boot.uncaughtException(new Error("fatal"));
    expect(H.errorBox).not.toHaveBeenCalled();
  });

  const recovered = { title: "LatexDo", rootChildCount: 1, origin: "latexdo://app" };
  const e2eBoot = (options: {
    child?: () => unknown;
    recovery?: unknown;
    crash?: (contents: any, boot: () => any) => void;
  }) => {
    let current: any;
    const spawned: string[][] = [];
    const promise = bootMain({
      argv: ["--e2e-test"],
      before: () => {
        H.spawn = (_command: string, args: string[]) => {
          spawned.push(args);
          return (options.child ?? (() => fakeChild()))();
        };
        let calls = 0;
        H.executeJavaScript = async () =>
          ++calls === 1
            ? [{ name: "list-project", status: "passed" }]
            : (options.recovery ?? recovered);
        H.crashRenderer =
          options.crash === undefined
            ? (contents) =>
                setTimeout(
                  () =>
                    current.appEvent(
                      "render-process-gone",
                      {},
                      contents,
                      crashed("killed", 0),
                    ),
                  40,
                )
            : (contents) => options.crash!(contents, () => current);
      },
    }).then((boot) => (current = boot));
    return { promise, spawned };
  };

  it("runs the packaged end-to-end workflow with a Git fixture and crash recovery", async () => {
    const { promise, spawned } = e2eBoot({});
    const boot = await promise;
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(0), { timeout: 10_000 });
    expect(H.setPath).toHaveBeenCalledWith(
      "userData",
      path.join(boot.profile, `latexdo-e2e-${process.pid}`),
    );
    expect(spawned.map((args) => args[0])).toEqual([
      "--version",
      "init",
      "config",
      "config",
      "add",
      "commit",
    ]);
    const script = boot.window.webContents.executeJavaScript.mock.calls[0][0];
    expect(script).not.toContain('"gitProjectId":null');
    expect(boot.window.webContents.forcefullyCrashRenderer).toHaveBeenCalled();
  });

  it.each([
    ["exits with an error code", () => fakeChild({ exitCode: 1 })],
    ["is killed by a signal", () => fakeChild({ exitCode: null, signal: "SIGTERM" })],
    ["has no exit details", () => fakeChild({ exitCode: null })],
    ["cannot start", () => fakeChild({ error: new Error("ENOENT") })],
  ])("skips the Git fixture when git %s", async (_, child) => {
    const { promise } = e2eBoot({ child });
    const boot = await promise;
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(0), { timeout: 10_000 });
    expect(boot.window.webContents.executeJavaScript.mock.calls[0][0]).toContain(
      '"gitProjectId":null',
    );
  });

  it("skips the Git fixture when git hangs", async () => {
    const restore = fastTimers([8_000]);
    try {
      const children: any[] = [];
      const { promise } = e2eBoot({
        child: () => {
          const child = fakeChild({ hang: true });
          children.push(child);
          return child;
        },
      });
      await promise;
      await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(0), {
        timeout: 10_000,
      });
      expect(children[0].kill).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("fails the end-to-end run when the renderer does not recover cleanly", async () => {
    const { promise } = e2eBoot({ recovery: { ...recovered, rootChildCount: 0 } });
    await promise;
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1), { timeout: 10_000 });
    expect(H.exit).not.toHaveBeenCalledWith(0);
  });

  it("fails the end-to-end run when recovery never starts", async () => {
    const realNow = Date.now.bind(Date);
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    const { promise } = e2eBoot({
      crash: () => {
        setTimeout(() => (skew = 30_000), 5);
      },
    });
    await promise;
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1), { timeout: 10_000 });
  });

  it("does not treat an unrequested renderer crash as part of the recovery check", async () => {
    const { promise } = e2eBoot({ crash: () => undefined });
    const boot = await promise;
    H.executeJavaScript = () => new Promise(() => undefined);
    boot.appEvent(
      "render-process-gone",
      {},
      boot.window.webContents,
      crashed("killed"),
    );
    await vi.waitFor(() => expect(H.exit).toHaveBeenCalledWith(1));
  });
});

describe("opening folders and Research Spaces from the system", () => {
  it("queues paths opened before startup and opens them on request", async () => {
    let folder = "";
    const boot = await bootMain({
      ready: false,
      before: async ({ root }) => {
        folder = path.join(root, "Finder Paper");
        await mkdir(folder);
      },
    });
    const preventDefault = vi.fn();
    boot.appEvent("open-file", { preventDefault }, "relative/path");
    boot.appEvent("open-file", { preventDefault }, folder);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    boot.appEvent("second-instance", {}, ["latexdo"]);
    H.resolveReady();
    await vi.waitFor(() => expect(H.handlers.has("project:open-requested")).toBe(true));
    const opened = await boot.call("project:open-requested");
    expect(opened.rootPath).toBe(folder);
    expect(await boot.call("project:open-requested")).toBeNull();
  });

  it("opens a Research Space passed on the command line and honours trust choices", async () => {
    let spaceFile = "";
    const boot = await bootMain({
      before: async ({ root }) => {
        const folder = path.join(root, "space-paper");
        await mkdir(folder);
        spaceFile = path.join(root, "Study.latexdo-space");
        await writeFile(spaceFile, JSON.stringify({ folders: [{ path: folder }] }));
        process.argv.push("--flag", spaceFile, path.join(root, "notes.txt"));
      },
    });
    H.fromWebContents = () => null;
    H.message.mockResolvedValueOnce({ response: 1 });
    expect(await boot.call("project:open-requested")).toBeNull();

    // A path that is neither a folder nor a Research Space cannot be opened.
    const preventDefault = vi.fn();
    boot.appEvent("open-file", { preventDefault }, path.join(boot.root, "missing.pdf"));
    await expect(boot.call("project:open-requested")).rejects.toThrow("cannot open");

    boot.appEvent("open-file", { preventDefault }, spaceFile);
    H.message.mockResolvedValueOnce({ response: 0, checkboxChecked: false });
    expect((await boot.call("project:open-requested")).researchSpace.name).toBe(
      "Study",
    );
    // The folder holding the space file is trusted, which covers its folders.
    boot.appEvent("open-file", { preventDefault }, spaceFile);
    H.message.mockClear();
    await boot.call("project:open-requested");
    expect(H.message).not.toHaveBeenCalled();
  });

  it("brings the existing window forward for a later open request", async () => {
    const boot = await bootMain();
    const window = boot.window;
    window.minimized = true;
    boot.appEvent("open-file", { preventDefault: vi.fn() }, boot.root);
    expect(window.restore).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith("project:open-requested");
    boot.appEvent("open-file", { preventDefault: vi.fn() }, boot.root);
    expect(window.restore).toHaveBeenCalledOnce();

    window.destroy();
    boot.appEvent("open-file", { preventDefault: vi.fn() }, boot.root);
    expect(H.createdWindows).toHaveLength(2);
  });

  it("gives a relaunch a working window", async () => {
    const boot = await bootMain();
    const first = boot.window;
    first.minimized = true;
    boot.appEvent("second-instance", {}, ["latexdo"]);
    expect(first.restore).toHaveBeenCalled();
    expect(first.show).toHaveBeenCalled();
    boot.appEvent("second-instance", {}, ["latexdo", "--inspect"]);
    expect(first.restore).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledTimes(2);

    boot.appEvent("second-instance", {}, [
      "latexdo",
      path.join(boot.root, "x.latexdo-space"),
    ]);
    expect(first.webContents.send).toHaveBeenCalledWith("project:open-requested");

    first.emit("unresponsive");
    boot.appEvent("second-instance", {}, ["latexdo"]);
    expect(first.destroy).toHaveBeenCalled();
    expect(H.createdWindows).toHaveLength(2);

    H.windows[0].destroy();
    boot.appEvent("second-instance", {}, ["latexdo"]);
    expect(H.createdWindows).toHaveLength(3);
  });
});

describe("platform differences", () => {
  it("adds Windows and Linux menu items and shortcuts", async () => {
    const boot = await bootMain({ platform: "linux" });
    const shortcuts = await boot.call("app:menu-shortcuts");
    expect(shortcuts).toContainEqual({
      menu: "File",
      label: "Save",
      keys: "Ctrl+S",
      editorOnly: false,
    });
    expect(shortcuts).toContainEqual(
      expect.objectContaining({ label: "Zoom In", keys: "Ctrl++" }),
    );
    const template = H.menu.mock.calls.find(([items]) =>
      items.some((item: any) => item.label === "File"),
    )![0];
    expect(template[0].label).toBe("File");
    const windowMenu = template.find((item: any) => item.label === "Window").submenu;
    const close = windowMenu.find((item: any) => item.label === "Close Window");
    close.click();
    expect(boot.window.close).toHaveBeenCalled();
    H.focusedWindow = null;
    expect(() => close.click()).not.toThrow();
  });

  it("chooses spell checker languages from the system locale", async () => {
    const boot = await bootMain({ platform: "linux" });
    const settings = () => boot.call("spellchecker:get-settings");
    H.locale = "en_GB";
    expect((await settings()).languages).toEqual(["en-US"]);
    H.locale = "fr";
    expect((await settings()).languages).toEqual(["fr", "en-US"]);
    H.locale = "";
    H.spellLanguages.splice(0, H.spellLanguages.length, "de");
    expect((await settings()).languages).toEqual(["de"]);
    H.locale = "-x";
    H.spellLanguages.splice(0, H.spellLanguages.length);
    expect((await settings()).languages).toEqual([]);
    H.spellLanguages.push("en-US", "fr");
    await writeFile(
      path.join(boot.profile, "spellchecker-settings.json"),
      JSON.stringify({ enabled: "yes", languages: "fr", customWords: [1, "Ada"] }),
    );
    expect(await settings()).toMatchObject({
      enabled: true,
      languages: ["en-US"],
      customWords: ["Ada"],
      usesSystemLanguage: false,
    });
    await writeFile(
      path.join(boot.profile, "spellchecker-settings.json"),
      JSON.stringify({ enabled: false, languages: ["fr", 3], customWords: "x" }),
    );
    expect(await settings()).toMatchObject({
      enabled: false,
      languages: ["fr"],
      customWords: [],
    });
    // Saving applies languages to every window and works without a focused one.
    H.focusedWindow = null;
    const saved = await boot.call("spellchecker:update-settings", {
      enabled: true,
      languages: ["fr"],
      customWords: [],
    });
    expect(saved.languages).toEqual(["fr"]);
    expect(
      boot.window.webContents.session.setSpellCheckerLanguages,
    ).toHaveBeenCalledWith(["fr"]);
    H.windows.splice(0);
    expect(
      (await boot.call("spellchecker:update-settings", saved)).availableLanguages,
    ).toEqual([]);
    H.fromWebContents = () => null;
    expect((await settings()).availableLanguages).toEqual([]);
  });

  it("compares trusted folders case-insensitively on Windows", async () => {
    const boot = await bootMain({ platform: "win32" });
    const folder = path.join(boot.root, "Paper");
    await mkdir(folder);
    H.open.mockResolvedValueOnce({ canceled: false, filePaths: [folder] });
    await boot.call("project:open");
    const stored = JSON.parse(
      await readFile(path.join(boot.profile, "trusted-workspaces.json"), "utf8"),
    );
    expect(stored.trustedPaths).toHaveLength(1);
    H.message.mockClear();
    H.open.mockResolvedValueOnce({ canceled: false, filePaths: [folder] });
    await boot.call("project:open");
    expect(H.message).not.toHaveBeenCalled();
  });
});
