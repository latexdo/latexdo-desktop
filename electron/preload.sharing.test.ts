import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatexDoApi } from "./preload.cjs";

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => bridge.exposed.set(name, api),
  },
  ipcRenderer: bridge,
  webUtils: { getPathForFile: bridge.getPathForFile },
}));

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const reply = (body: unknown, status = 200, statusText = "") => ({
  status,
  statusText,
  text: body === undefined ? "" : JSON.stringify(body),
});
const internet = "https://collab.latexdo.org";
const host = "latexdo-host://local";

async function load(env: Record<string, string> = {}): Promise<LatexDoApi> {
  vi.resetModules();
  bridge.exposed.clear();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  await import("./preload.cjs");
  return bridge.exposed.get("latexdo") as LatexDoApi;
}

/** Routes IPC channels to handlers; anything else resolves to undefined. */
function routeInvoke(routes: Record<string, (...args: never[]) => unknown>) {
  bridge.invoke.mockImplementation(async (channel: string, ...args: never[]) => {
    const route = routes[channel];
    return route ? route(...args) : undefined;
  });
}

function setOrigins(origins: Record<string, string>) {
  localStorage.setItem("latexdo.cloud.projectOrigins", JSON.stringify(origins));
}
function setTokens(tokens: Record<string, string>) {
  localStorage.setItem("latexdo.cloud.shareTokens", JSON.stringify(tokens));
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue({ ok: true });
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_LATEXDO_API_BASE_URL", "");
  vi.stubEnv("VITE_LATEXDO_HOSTED_EDITOR_URL", "");
  vi.stubEnv("LATEXDO_HOSTED_EDITOR_URL", "");
  vi.stubEnv("LATEXDO_COLLAB_URL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("storage resilience", () => {
  it("keeps working when local storage throws", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: "https://collab.example.org" });
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    vi.spyOn(proto, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(proto, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(proto, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    // A fresh session id is made each time but the request still goes out.
    fetchMock.mockImplementation(async () => json({ content: "x" }));
    expect(await api.readFile("project_a", "a.tex")).toBe("x");
    expect(fetchMock.mock.calls[0][1].headers["x-latexdo-session"]).toMatch(/^session-/);
    expect(await api.restoreCloudProject()).toBeNull();
    // Deleting forgets the active project through removeItem, which throws.
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(api.deleteSharedProject("project_a")).resolves.toBeUndefined();
  });

  it("ignores malformed stored tokens and origins", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: "https://collab.example.org" });
    localStorage.setItem("latexdo.cloud.shareTokens", "{bad");
    localStorage.setItem("latexdo.cloud.projectOrigins", "{bad");
    expect(await api.isProjectAdmin("project_a")).toBe(false);
    localStorage.setItem("latexdo.cloud.shareTokens", "[]");
    localStorage.setItem("latexdo.cloud.projectOrigins", "[]");
    expect(await api.isProjectAdmin("project_a")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("desktop input validation", () => {
  it("validates paths and project ids before reaching the main process", async () => {
    const api = await load();
    for (const bad of ["/abs", "a//b/../c", "./a", "x:\\y"]) {
      await expect(api.readFile("local", bad)).rejects.toThrow("Invalid desktop API input");
    }
    await expect(api.readFile("local", 5 as unknown as string)).rejects.toThrow();
    await expect(api.readAsset("local", "noext")).rejects.toThrow();
    bridge.invoke.mockResolvedValue("ok");
    expect(await api.readFile("local", "dir\\main.tex")).toBe("ok");
    expect(await api.readAsset("local", "fig/plot.JPEG")).toBe("ok");
    expect(bridge.invoke).toHaveBeenCalledWith("file:read", "local", "dir\\main.tex");
  });
});

describe("remote requests through the main process", () => {
  it("routes a share-token path to the project's host and maps failures", async () => {
    const api = await load();
    setOrigins({ project_r: "http://10.0.0.4:5000" });
    setTokens({ project_r: "tok" });
    const requests: Array<Record<string, unknown>> = [];
    let next: ReturnType<typeof reply> | Error = reply({
      enabled: true,
      users: [],
      token: "tok",
    });
    routeInvoke({
      "peer:request": (request: Record<string, unknown>) => {
        requests.push(request);
        if (next instanceof Error) throw next;
        return next;
      },
    });
    const state = await api.getCollaborationState("project_r");
    expect(requests[0]).toMatchObject({
      origin: "http://10.0.0.4:5000",
      path: "/api/shares/tok/presence",
      method: "POST",
    });
    expect(state).toMatchObject({ apiBaseUrl: "http://10.0.0.4:5000", hosted: false });
    expect(state.inviteCode).toBeUndefined();

    next = reply(undefined, 500, "Server Error");
    next.text = "not json";
    await expect(api.readFile("project_r", "a.tex")).rejects.toThrow("500 Server Error");
    next = reply({ code: 7 }, 409, "");
    await expect(api.readFile("project_r", "a.tex")).rejects.toThrow("409");
    next = reply(undefined);
    expect(await api.writeFile("project_r", "a.tex", "x")).toBeUndefined();
    next = "boom" as unknown as Error;
    routeInvoke({
      "peer:request": () => {
        throw "plain failure";
      },
    });
    await expect(api.readFile("project_r", "a.tex")).rejects.toThrow("plain failure");
  });

  it("cancels a remote compile mid-flight", async () => {
    const api = await load();
    setOrigins({ project_r: "http://10.0.0.4:5000" });
    let release!: (value: unknown) => void;
    routeInvoke({
      "peer:request": () => new Promise((resolve) => (release = resolve)),
      "latex:compile-cancel": () => false,
    });
    const compiling = api.compile({
      projectId: "project_r",
      rootFile: "main.tex",
      engine: "pdflatex",
    } as never);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await api.cancelCompile("project_r")).toBe(true);
    release(reply({ files: [] }));
    expect(await compiling).toMatchObject({ ok: false, error: "Cloud request cancelled." });
  });

  it("refuses a request whose signal is already aborted", async () => {
    const api = await load();
    setOrigins({ project_r: "http://10.0.0.4:5000" });
    routeInvoke({ "peer:request": () => reply({ files: [] }) });
    // Start and cancel before the bundle request resolves.
    const compiling = api.compile({ projectId: "project_r", rootFile: "m", engine: "pdflatex" } as never);
    await api.cancelCompile("project_r");
    expect(await compiling).toMatchObject({ ok: false, error: "Cloud request cancelled." });
  });
});

describe("a configured collaboration server", () => {
  const server = "https://collab.example.org";

  it("times out and cancels HTTP requests", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const reading = api.readFile("project_a", "a.tex");
    const expectation = expect(reading).rejects.toThrow("Cloud request timed out.");
    await vi.advanceTimersByTimeAsync(15_001);
    await expectation;

    const compiling = api.compile({ projectId: "project_a", rootFile: "m", engine: "pdflatex" } as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(await api.cancelCompile("project_a")).toBe(true);
    expect(await compiling).toMatchObject({ error: "Cloud request cancelled." });
  });

  it("refuses an already-cancelled signal and passes other errors through", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    fetchMock.mockImplementation(async () => {
      await api.cancelCompile("project_a");
      throw new Error("network");
    });
    const result = await api.compile({ projectId: "project_a", rootFile: "m", engine: "pdflatex" } as never);
    expect(result).toMatchObject({ error: "Cloud request cancelled." });
    fetchMock.mockRejectedValue("string failure");
    expect(
      await api.compile({ projectId: "project_a", rootFile: "m", engine: "pdflatex" } as never),
    ).toMatchObject({ error: "Could not compile the shared project locally." });
    fetchMock.mockImplementation(async () => new Response("<html>", { status: 502, statusText: "Bad" }));
    await expect(api.readFile("project_a", "a")).rejects.toThrow("502 Bad");
    fetchMock.mockImplementation(async () => json({}, 500));
    await expect(api.readFile("project_a", "a")).rejects.toThrow("500");
  });

  it("returns undefined for an empty success body", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    fetchMock.mockImplementation(async () => new Response("", { status: 200 }));
    expect(await api.trashEntry("project_a", "a.tex")).toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `${server}/api/projects/project_a/files?path=a.tex`,
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("copies, lists and trashes entries on either backend", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    fetchMock.mockImplementation(async () => json({ relativePath: "b.tex" }));
    expect(await api.copyEntry("project_a", "a.tex", "b.tex")).toBe("b.tex");
    fetchMock.mockImplementation(async () => json([{ type: "file", relativePath: "a.tex" }]));
    expect(await api.listProject("project_a")).toHaveLength(1);
    bridge.invoke.mockResolvedValue("copied");
    expect(await api.copyEntry("local", "a", "b")).toBe("copied");
    await api.trashEntry("local", "a");
    expect(bridge.invoke).toHaveBeenCalledWith("entry:copy", "local", "a", "b");
    expect(bridge.invoke).toHaveBeenCalledWith("entry:trash", "local", "a");
  });

  it("joins through a share link in the query string or a co-author web link", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    fetchMock.mockImplementation(async () => 
      json({
        project: { id: "project_q", name: "Q" },
        collaboration: { enabled: true, users: [], token: "fresh" },
      }),
    );
    const joined = await api.joinCollaboration(`${server}/?share=qtok`);
    if (joined.pending) throw new Error("unexpected");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/shares/qtok/open");
    // The server's current token replaces the one used to join.
    expect(JSON.parse(localStorage.getItem("latexdo.cloud.shareTokens")!)).toEqual({
      project_q: "fresh",
    });
    expect(joined.collaboration.shareUrl).toBe(`${server}/#share=fresh`);

    const nonApproval = new Response(JSON.stringify({ error: "nope" }), { status: 403 });
    fetchMock.mockResolvedValueOnce(nonApproval);
    await expect(api.joinCollaboration("raw")).rejects.toThrow("nope");

    routeInvoke({
      "peer:resolve-invite": (invite: string) => ({ origin: server, token: invite }),
    });
    fetchMock.mockImplementation(async () => 
      json({ project: { id: "project_w", name: "W" }, collaboration: { enabled: true, users: [] } }),
    );
    await api.joinCollaboration("https://latexdo.org/join#abc_DEF-1");
    expect(bridge.invoke).toHaveBeenCalledWith("peer:resolve-invite", "latexdo-invite:abc_DEF-1");
  });

  it("uses the hosted editor URL for share links and none without one", async () => {
    const api = await load({
      VITE_LATEXDO_API_BASE_URL: server,
      VITE_LATEXDO_HOSTED_EDITOR_URL: "https://editor.example.org/app",
    });
    fetchMock.mockImplementation(async () => json({ enabled: true, users: [], token: "t1" }));
    const state = await api.getCollaborationState("project_a");
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${server}/api/projects/project_a/share`);
    expect(state.shareUrl).toBe("https://editor.example.org/app#share=t1");
  });

  it("rotates and stops links, keeping the stored token in step", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    setTokens({ project_a: "old" });
    fetchMock.mockResolvedValueOnce(json({ enabled: true, users: [], token: "new" }));
    const rotated = await api.rotateCollaborationLink("project_a");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/share/rotate");
    expect(fetchMock.mock.calls[0][1].headers["x-latexdo-share-token"]).toBe("old");
    expect(rotated.token).toBe("new");
    fetchMock.mockResolvedValueOnce(json({ enabled: true, users: [] }));
    expect((await api.rotateCollaborationLink("project_a")).token).toBe("new");
    fetchMock.mockResolvedValueOnce(json({ enabled: false, users: [] }));
    const stopped = await api.stopCollaboration("project_a");
    expect(stopped.token).toBeUndefined();
    expect(localStorage.getItem("latexdo.cloud.shareTokens")).toBe("{}");
    // Stopping again with nothing stored leaves storage alone.
    fetchMock.mockResolvedValueOnce(json({ enabled: false, users: [] }));
    await api.stopCollaboration("project_a");
    expect(await api.stopCollaboration("local")).toEqual({ enabled: false, users: [] });
  });

  it("uploads a local folder to the server, skipping files it cannot hold", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    routeInvoke({
      "project:list": () => [
        {
          type: "directory",
          relativePath: "figs",
          children: [{ type: "file", relativePath: "figs/a.png" }],
        },
        { type: "file", relativePath: "main.tex" },
      ],
      "file:read": (_id: string, path: string) => {
        if (path.endsWith(".png")) throw new Error("binary");
        return "text";
      },
    });
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/api/projects")
        ? json({ id: "project_new", name: "Paper" })
        : String(url).endsWith("/share")
          ? json({ enabled: true, users: [], token: "s" })
          : new Response(null, { status: 204 }),
    );
    const state = await api.createCollaborationLink("local", { projectName: "Paper" });
    expect(state.token).toBe("s");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("figs/a.png"));
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      `${server}/api/projects`,
      `${server}/api/projects/project_new/files/content?path=main.tex`,
      `${server}/api/projects/project_new/share`,
    ]);
    // Without a name, a default folder name is used.
    fetchMock.mockClear();
    await api.createCollaborationLink("local");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      folderName: "LatexDo Shared Project",
    });
    // A project already on the server just gets a share.
    fetchMock.mockClear();
    await api.createCollaborationLink("project_new");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/project_new/share");
  });

  it("enforces upload limits", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    fetchMock.mockImplementation(async () => json({ id: "project_new", name: "P" }));
    routeInvoke({ "project:list": () => [{ type: "file", relativePath: "a", limited: true }] });
    await expect(api.createCollaborationLink("local")).rejects.toThrow("scan limit");
    routeInvoke({
      "project:list": () => [
        { type: "directory", relativePath: "d", children: [{ type: "file", relativePath: "d/x", limited: true }] },
      ],
    });
    await expect(api.createCollaborationLink("local")).rejects.toThrow("scan limit");
    routeInvoke({
      "project:list": () =>
        Array.from({ length: 501 }, (_, i) => ({ type: "file", relativePath: `f${i}` })),
    });
    await expect(api.createCollaborationLink("local")).rejects.toThrow(
      "Cloud projects are limited to 500 files.",
    );
    routeInvoke({
      "project:list": () => [{ type: "file", relativePath: "big.tex" }],
      "file:read": () => "x".repeat(2 * 1024 * 1024 + 1),
    });
    await expect(api.createCollaborationLink("local")).rejects.toThrow(
      "big.tex is larger than 2 MB, the most the cloud accepts for one file.",
    );
    routeInvoke({
      "project:list": () =>
        Array.from({ length: 11 }, (_, i) => ({ type: "file", relativePath: `f${i}` })),
      "file:read": () => "x".repeat(2 * 1024 * 1024),
    });
    fetchMock.mockImplementation(async () => json({ id: "project_new", name: "P" }));
    await expect(api.createCollaborationLink("local")).rejects.toThrow(
      "Cloud projects are limited to 20 MB.",
    );
  });

  it("falls back to text when the server has no binary files", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    fetchMock
      .mockResolvedValueOnce(json({ error: "missing" }, 404))
      .mockResolvedValueOnce(json({ content: "<svg/>" }));
    expect(new TextDecoder().decode(await api.readAsset("project_a", "f.svg"))).toBe("<svg/>");
    fetchMock.mockResolvedValueOnce(json({ error: "forbidden" }, 403));
    await expect(api.readAsset("project_a", "f.svg")).rejects.toThrow("forbidden");
  });

  it("restores through the share token, rethrowing unexpected failures", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    localStorage.setItem("latexdo.cloud.activeProject", "project_a");
    setTokens({ project_a: "tok" });
    fetchMock
      .mockRejectedValueOnce(new Error("no directory"))
      .mockResolvedValueOnce(
        json({ project: { id: "project_a", name: "P" }, collaboration: { enabled: true, users: [] } }),
      );
    expect(await api.restoreCloudProject()).toMatchObject({ id: "project_a" });
    fetchMock
      .mockResolvedValueOnce(json({ projects: [{ id: "project_a", name: 5 }] }))
      .mockResolvedValueOnce(json({ error: "down" }, 500));
    await expect(api.restoreCloudProject()).rejects.toThrow("down");
  });

  it("saves and adds folders to research spaces, downloading shared copies", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    fetchMock.mockImplementation(async () => json({ files: [{ relativePath: "a.tex", content: "A" }] }));
    bridge.invoke.mockResolvedValue({ id: "local2" });
    expect(await api.saveResearchSpaceAs("project_a", "Paper")).toEqual({ id: "local2" });
    expect(bridge.invoke).toHaveBeenCalledWith("research-space:save-as-cloud", "Paper", [
      { relativePath: "a.tex", content: "A" },
    ]);
    await api.saveResearchSpaceAs("project_b");
    expect(bridge.invoke).toHaveBeenLastCalledWith("research-space:save-as-cloud", "", expect.any(Array));
    await expect(api.addFolderToResearchSpace("project_a")).rejects.toThrow(
      "Save as Research Space first",
    );
  });

  it("picks files to add to a shared project and keeps docs imports local", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    routeInvoke({
      "file:choose-external-for-share": () => [
        { sourcePath: "/x/a.png", relativePath: "a.png" },
      ],
      "docx:import": () => "docx",
      "markdown:import": () => "md",
      "pdf:import": () => "pdf",
    });
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const imported = await api.chooseImportExternalFiles("project_a", "/");
    expect(imported).toEqual([{ sourcePath: "/x/a.png", relativePath: "a.png", type: "file" }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ base64: "" });
    expect(await api.importDocx()).toBe("docx");
    expect(await api.importMarkdown()).toBe("md");
    expect(await api.importPdf()).toBe("pdf");
    expect(bridge.invoke).toHaveBeenCalledWith("docx:import", "");
  });

  it("approves newcomers and resolves join requests", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    await expect(api.setCollaborationApproval("project_a", true)).rejects.toThrow("not been shared");
    await expect(api.resolveCollaborationRequest("project_a", "c", true)).rejects.toThrow(
      "not been shared",
    );
    await expect(api.setCollaborationApproval("local", true)).rejects.toThrow("not been shared");
    await expect(api.resolveCollaborationRequest("local", "c", true)).rejects.toThrow(
      "not been shared",
    );
    setTokens({ project_a: "tok" });
    fetchMock.mockImplementation(async () => json({ enabled: true, users: [], requireApproval: true }));
    expect((await api.setCollaborationApproval("project_a", true)).requireApproval).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ requireApproval: true }),
    });
    await api.resolveCollaborationRequest("project_a", "client/1", true);
    await api.resolveCollaborationRequest("project_a", "client/1", false);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/pending/client%2F1");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "approve" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: "deny" });
  });

  it("deletes a shared copy, tolerating one already gone", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    await api.deleteSharedProject("local");
    expect(fetchMock).not.toHaveBeenCalled();
    localStorage.setItem("latexdo.cloud.activeProject", "project_a");
    setTokens({ project_a: "tok", project_b: "b" });
    fetchMock.mockResolvedValueOnce(json({ error: "gone" }, 404));
    await api.deleteSharedProject("project_a");
    expect(bridge.invoke).toHaveBeenCalledWith("peer:forget-shared-project", "project_a");
    expect(localStorage.getItem("latexdo.cloud.activeProject")).toBeNull();
    expect(JSON.parse(localStorage.getItem("latexdo.cloud.shareTokens")!)).toEqual({ project_b: "b" });
    localStorage.setItem("latexdo.cloud.activeProject", "project_c");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteSharedProject("project_b");
    expect(localStorage.getItem("latexdo.cloud.activeProject")).toBe("project_c");
    fetchMock.mockResolvedValueOnce(json({ error: "denied" }, 403));
    await expect(api.deleteSharedProject("project_b")).rejects.toThrow("denied");
  });

  it("saves the shared copy back through the host for non-internet projects", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    bridge.invoke.mockResolvedValue({ saved: true });
    expect(await api.saveSharedProjectToFolder("project_a")).toEqual({ saved: true });
    expect(bridge.invoke).toHaveBeenCalledWith("peer:host-save-project", "project_a", true);
    await api.saveSharedProjectToFolder("project_a", { ask: false });
    expect(bridge.invoke).toHaveBeenLastCalledWith("peer:host-save-project", "project_a", false);
    await api.openSharedProjectFolder("project_a");
    expect(bridge.invoke).toHaveBeenLastCalledWith("peer:host-open-folder", "project_a");
  });

  it("rejects Git actions on shared copies and forwards them for folders", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: server });
    for (const call of [
      () => api.getGitRepositoryInfo("project_a"),
      () => api.runGitAction("project_a", { kind: "pull" } as never),
      () => api.getGitDiffForCommitMessage("project_a"),
    ]) {
      await expect(call()).rejects.toThrow("Back to my folder");
    }
    expect(await api.getGitGraph("project_a", { limit: 5, refs: "all" })).toEqual({
      scope: "repo",
      target: null,
      commits: [],
      hasMore: false,
    });
    bridge.invoke.mockResolvedValue("r");
    await api.getGitRepositoryInfo("local");
    await api.runGitAction("local", { kind: "pull" } as never);
    await api.getGitGraph("local", { limit: 5, refs: "all" });
    await api.getGitDiffForCommitMessage("local");
    expect(bridge.invoke.mock.calls.map((call) => call[0])).toEqual([
      "git:repository-info",
      "git:action",
      "git:graph",
      "git:diff-for-message",
    ]);
  });
});

describe("sharing from this computer", () => {
  const status = { active: true, mode: "local", phase: "ready", addresses: [] };

  it("reports a failed local host start", async () => {
    const api = await load();
    routeInvoke({
      "peer:host-start": () => {
        throw new Error("Error invoking remote method 'peer:host-start': Error: Port busy");
      },
    });
    await expect(api.createCollaborationLink("local", { mode: "local" })).rejects.toThrow(
      /^Port busy$/,
    );
  });

  it("re-shares a hosted project and keeps the host up while another is shared", async () => {
    const api = await load();
    setOrigins({ project_h: host, project_g: host });
    setTokens({ project_h: "t" });
    const requests: string[] = [];
    routeInvoke({
      "peer:host-status": () => status,
      "peer:host-invite": () => null,
      "peer:request": (request: { path: string; method: string }) => {
        requests.push(`${request.method} ${request.path}`);
        return reply({ enabled: request.method !== "DELETE", token: "t", users: [] });
      },
    });
    const state = await api.createCollaborationLink("project_h", { mode: "local" });
    expect(requests).toEqual(["POST /api/projects/project_h/share"]);
    expect(state).toMatchObject({ hosted: true, host: status });
    expect(state.inviteCode).toBeUndefined();
    await api.createCollaborationLink("project_g", { mode: "local" });
    await api.stopCollaboration("project_h");
    expect(bridge.invoke).not.toHaveBeenCalledWith("peer:host-stop");
  });

  it("moves a hosted project to the always-on server from its folder", async () => {
    const api = await load();
    setOrigins({ project_h: host });
    routeInvoke({ "peer:host-open-folder": () => null });
    await expect(api.createCollaborationLink("project_h")).rejects.toThrow(
      "Open your folder (Back to my folder) and share it again.",
    );
    const requests: string[] = [];
    routeInvoke({
      "peer:host-open-folder": () => ({ id: "folder-id", name: "F", rootPath: "/f" }),
      "project:list": () => [],
      "peer:has-folder": () => false,
      "peer:cloud-invite": () => null,
      "peer:request": (request: { path: string; method: string; origin: string }) => {
        requests.push(`${request.method} ${request.origin}${request.path}`);
        return request.path === "/api/projects"
          ? reply({ id: "project_i", name: "F" })
          : reply({ enabled: true, users: [], token: "tk" });
      },
    });
    const state = await api.createCollaborationLink("project_h");
    expect(requests).toEqual([
      `POST ${internet}/api/projects`,
      `POST ${internet}/api/projects/project_i/share`,
    ]);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "peer:host-register-project",
      "project_i",
      "folder-id",
      "",
    );
    // Not the owner's copy: no host block, and no invite when none is made.
    expect(state).toMatchObject({ hosted: false, apiBaseUrl: internet });
    expect(state.host).toBeUndefined();
    expect(state.inviteCode).toBeUndefined();
  });

  it("describes a stopped internet share of the owner's own copy", async () => {
    const api = await load({ LATEXDO_COLLAB_URL: "https://my.collab.example/" });
    setOrigins({ project_i: "https://my.collab.example" });
    routeInvoke({
      "peer:has-folder": () => true,
      "peer:request": () => reply({ enabled: false, users: [] }),
    });
    const state = await api.stopCollaboration("project_i");
    expect(state.host).toEqual({
      active: false,
      mode: "internet",
      phase: "off",
      addresses: ["https://my.collab.example"],
    });
  });

  it("enforces the sharing limits for internet and local uploads", async () => {
    const api = await load();
    routeInvoke({
      "project:list": () =>
        Array.from({ length: 2001 }, (_, i) => ({ type: "file", relativePath: `f${i}` })),
      "peer:request": () => reply({ id: "project_x", name: "X" }),
      "peer:host-start": () => status,
    });
    await expect(api.createCollaborationLink("local")).rejects.toThrow(
      "Shared projects are limited to 2000 files.",
    );
    await expect(api.createCollaborationLink("local", { mode: "local" })).rejects.toThrow(
      "Shared projects are limited to 2000 files.",
    );
    routeInvoke({
      "project:list": () => [{ type: "file", relativePath: "huge.bin" }],
      "file:read": () => {
        throw new Error("binary");
      },
      "file:read-cloud-upload": () => ({ contentBase64: "", size: 26 * 1024 * 1024 }),
      "peer:request": () => reply({ id: "project_x", name: "X" }),
      "peer:host-start": () => status,
    });
    await expect(api.createCollaborationLink("local")).rejects.toThrow(
      "huge.bin is larger than 25 MB, the most sharing accepts for one file.",
    );
    routeInvoke({
      "project:list": () => [{ type: "file", relativePath: "huge.bin" }],
      "file:read": () => {
        throw new Error("binary");
      },
      "file:read-cloud-upload": () => ({ contentBase64: "", size: 33 * 1024 * 1024 }),
      "peer:request": () => reply({ id: "project_x", name: "X" }),
      "peer:host-start": () => status,
    });
    await expect(api.createCollaborationLink("local", { mode: "local" })).rejects.toThrow(
      "larger than 32 MB",
    );
  });

  it("restores a project on another host without a stored invite as nothing", async () => {
    const api = await load();
    localStorage.setItem("latexdo.cloud.activeProject", "project_r");
    setOrigins({ project_r: "http://10.0.0.4:5000" });
    expect(await api.restoreCloudProject()).toBeNull();
    expect(localStorage.getItem("latexdo.cloud.activeProject")).toBeNull();
  });

  it("restores the owner's internet project from the server directory", async () => {
    const api = await load();
    localStorage.setItem("latexdo.cloud.activeProject", "project_i");
    setOrigins({ project_i: internet });
    routeInvoke({
      "peer:request": () => reply({ projects: [{ id: "project_i", name: "Mine" }] }),
    });
    expect(await api.restoreCloudProject()).toEqual({
      id: "project_i",
      name: "Mine",
      rootPath: "",
    });
  });

  it("saves the internet copy back into its folder", async () => {
    const api = await load();
    setOrigins({ project_i: internet });
    setTokens({ project_i: "tok" });
    routeInvoke({
      "peer:request": () => reply({ files: [{ relativePath: "a.tex", content: "A" }] }),
      "peer:cloud-save-project": () => ({ saved: true }),
    });
    expect(await api.saveSharedProjectToFolder("project_i", { ask: false })).toEqual({
      saved: true,
    });
    expect(bridge.invoke).toHaveBeenCalledWith(
      "peer:cloud-save-project",
      "project_i",
      [{ relativePath: "a.tex", content: "A" }],
      false,
    );
  });

  it("removes a copy hosted here even when its server is off", async () => {
    const api = await load();
    setOrigins({ project_h: host });
    routeInvoke({
      "peer:request": () => {
        throw new Error("offline");
      },
    });
    await api.deleteSharedProject("project_h");
    expect(bridge.invoke).toHaveBeenCalledWith("peer:forget-shared-project", "project_h");
  });

  it("routes share-token paths with odd encodings", async () => {
    const api = await load();
    setOrigins({ "project_%": "http://h:1" });
    setTokens({ "project_%": "%E0" });
    const origins: string[] = [];
    routeInvoke({
      "peer:request": (request: { origin: string }) => {
        origins.push(request.origin);
        return reply({ enabled: true, users: [] });
      },
    });
    // The bad percent-encoding is kept as-is and still finds its project.
    await api.isProjectAdmin("project_%");
    expect(origins[0]).toBe("http://h:1");
  });

  it("notifies about host sharing changes and stops listening", async () => {
    const api = await load();
    const callback = vi.fn();
    const stop = api.onHostSharingChanged(callback);
    const listener = bridge.on.mock.calls[0][1];
    listener({}, status);
    expect(callback).toHaveBeenCalledWith(status);
    stop();
    expect(bridge.removeListener).toHaveBeenCalledWith("peer:host-changed", listener);
  });

  it("handles socket errors, failed opens and default close codes", async () => {
    const api = await load();
    let failOpen = false;
    routeInvoke({
      "peer:socket-open": () => {
        if (failOpen) throw new Error("refused");
        return true;
      },
    });
    const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    const socket = api.connectCollaborationSocket(host, "/x", handlers);
    const emit = bridge.on.mock.calls.find(([c]) => c === "peer:socket-event")![1] as (
      event: unknown,
      payload: unknown,
    ) => void;
    const id = bridge.invoke.mock.calls.find(([c]) => c === "peer:socket-open")![1];
    emit({}, null);
    emit({}, "text");
    emit({}, { id: "x", type: "open" });
    emit({}, { id: 999, type: "open" });
    emit({}, { id, type: "message", data: "not bytes" });
    emit({}, { id, type: "error" });
    emit({}, { id, type: "unknown" });
    expect(handlers.onMessage).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledOnce();
    emit({}, { id, type: "close" });
    expect(handlers.onClose).toHaveBeenCalledWith(1006, "");
    socket.send(new Uint8Array([1]));
    expect(bridge.send).not.toHaveBeenCalled();

    failOpen = true;
    const second = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    const failed = api.connectCollaborationSocket(host, "/y", second);
    await vi.waitFor(() => expect(second.onClose).toHaveBeenCalledWith(1006, ""));
    expect(second.onError).toHaveBeenCalled();
    failed.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.send).not.toHaveBeenCalledWith("peer:socket-close", expect.anything(), undefined, undefined);
    // Only one event listener is ever bound.
    api.connectCollaborationSocket(host, "/z", handlers);
    expect(bridge.on.mock.calls.filter(([c]) => c === "peer:socket-event")).toHaveLength(1);
  });
});

describe("edge cases", () => {
  it("fails clearly when no server is configured for an unknown shared project", async () => {
    const api = await load();
    await expect(api.readFile("project_x", "a.tex")).rejects.toThrow(
      "No collaboration server is configured.",
    );
    localStorage.setItem("latexdo.cloud.projectOrigins", "{bad");
    await expect(api.readFile("project_x", "a.tex")).rejects.toThrow(
      "No collaboration server is configured.",
    );
  });

  it("reads shared files one by one, skipping limited and folder entries", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: "https://collab.example.org" });
    fetchMock
      .mockImplementationOnce(async () => json({ error: "no bundles" }, 404))
      .mockImplementationOnce(async () =>
        json([
          { type: "file", relativePath: "big.tex", limited: true },
          { type: "directory", relativePath: "d", children: [] },
          { type: "file", relativePath: "main.tex" },
        ]),
      )
      .mockImplementationOnce(async () => json({ content: "M" }));
    bridge.invoke.mockResolvedValue({ id: "saved" });
    await api.saveResearchSpaceAs("project_a", "P");
    expect(bridge.invoke).toHaveBeenCalledWith("research-space:save-as-cloud", "P", [
      { relativePath: "main.tex", content: "M" },
    ]);
  });

  it("shares a project the server returns no token for, and reports presence", async () => {
    const api = await load({ VITE_LATEXDO_API_BASE_URL: "https://collab.example.org" });
    fetchMock.mockImplementation(async () => json({ enabled: false, users: [] }));
    const state = await api.createCollaborationLink("project_a");
    expect(state.token).toBeUndefined();
    expect(state.shareUrl).toBeUndefined();
    setTokens({ project_a: "tok" });
    await api.updateCollaborationPresence("project_a");
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ currentFile: null });
  });

  it("hosts on this network without a project name", async () => {
    const api = await load();
    routeInvoke({
      "peer:host-start": () => ({ active: true }),
      "project:list": () => [],
      "peer:request": (request: { path: string }) =>
        request.path === "/api/projects"
          ? reply({ id: "project_l", name: "L" })
          : reply({ enabled: true, users: [] }),
    });
    await api.createCollaborationLink("local", { mode: "local" });
    expect(bridge.invoke).toHaveBeenCalledWith(
      "peer:host-register-project",
      "project_l",
      "local",
      "",
    );
  });

  it("closes a socket only once when its open fails after the host closed it", async () => {
    const api = await load();
    let rejectOpen!: (error: Error) => void;
    routeInvoke({
      "peer:socket-open": () => new Promise((_resolve, reject) => (rejectOpen = reject)),
    });
    const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
    api.connectCollaborationSocket(host, "/x", handlers);
    const emit = bridge.on.mock.calls.find(([c]) => c === "peer:socket-event")![1] as (
      event: unknown,
      payload: unknown,
    ) => void;
    const id = bridge.invoke.mock.calls.find(([c]) => c === "peer:socket-open")![1];
    emit({}, { id, type: "close", code: 4000, reason: "bye" });
    await vi.waitFor(() => expect(rejectOpen).toBeTypeOf("function"));
    rejectOpen(new Error("late"));
    await vi.waitFor(() => expect(handlers.onError).toHaveBeenCalled());
    expect(handlers.onClose).toHaveBeenCalledExactlyOnceWith(4000, "bye");
  });
});

describe("remaining desktop events", () => {
  it("forwards spell checker and open-request events", async () => {
    const api = await load();
    const settings = vi.fn();
    const stopSettings = api.onSpellCheckerSettingsChanged(settings);
    const settingsListener = bridge.on.mock.calls[0][1];
    settingsListener({}, { enabled: true });
    expect(settings).toHaveBeenCalledWith({ enabled: true });
    stopSettings();
    const requested = vi.fn();
    const stopRequested = api.onOpenRequested(requested);
    const requestedListener = bridge.on.mock.calls[1][1];
    requestedListener({}, "ignored");
    expect(requested).toHaveBeenCalledWith();
    stopRequested();
    expect(bridge.removeListener.mock.calls.map((call) => call[0])).toEqual([
      "spellchecker:changed",
      "project:open-requested",
    ]);
    bridge.invoke.mockResolvedValue(null);
    expect(await api.openRequestedProject()).toBeNull();
    expect(bridge.invoke).toHaveBeenCalledWith("project:open-requested");
  });
});
