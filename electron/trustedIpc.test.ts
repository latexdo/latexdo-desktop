import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registration = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: registration }));
import { ipcMain, trustIpcRenderer } from "./trustedIpc.js";

function sender(url = "latexdo://app/index.html") {
  const mainFrame = { url };
  const contents = { mainFrame, isDestroyed: () => false } as unknown as WebContents;
  const event = { sender: contents, senderFrame: mainFrame } as IpcMainInvokeEvent;
  return { contents, event, mainFrame };
}
beforeEach(() => vi.clearAllMocks());

describe("privileged IPC sender boundary", () => {
  it("allows only the registered window main frame at its renderer URL", async () => {
    const { contents, event } = sender();
    trustIpcRenderer(contents, "latexdo://app/index.html");
    const handler = vi.fn().mockResolvedValue("result");
    ipcMain.handle("file:read", handler);
    const invoke = registration.handle.mock.calls[0][1];
    expect(await invoke(event, "argument")).toBe("result");
    expect(handler).toHaveBeenCalledWith(event, "argument");
    expect(() =>
      invoke({ ...event, senderFrame: { url: event.senderFrame?.url } }),
    ).toThrow(/Untrusted/);
  });
  it.each([
    "https://attacker.test/",
    "latexdo://other/index.html",
    "latexdo://app/other.html",
    "file:///index.html",
  ])("rejects unexpected navigation to %s", (url) => {
    const { contents, event } = sender(url);
    trustIpcRenderer(contents, "latexdo://app/index.html");
    const handler = vi.fn();
    ipcMain.handle("ai:credential-get", handler);
    expect(() => registration.handle.mock.calls[0][1](event)).toThrow(/Untrusted/);
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects an unregistered window even at the correct URL", () => {
    const { event } = sender();
    ipcMain.handle("file:write", vi.fn());
    expect(() => registration.handle.mock.calls[0][1](event)).toThrow(/Untrusted/);
  });
  it("drops unauthorized fire-and-forget messages without crashing", () => {
    const { event } = sender();
    const handler = vi.fn();
    ipcMain.on("terminal:write", handler);
    expect(() =>
      registration.on.mock.calls[0][1](event as unknown as IpcMainEvent, "command"),
    ).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
  it("allows development renderer hashes but rejects a different port", () => {
    const { contents, event, mainFrame } = sender(
      "http://127.0.0.1:5173/#share=example",
    );
    trustIpcRenderer(contents, "http://127.0.0.1:5173/");
    const handler = vi.fn();
    ipcMain.handle("file:read", handler);
    const invoke = registration.handle.mock.calls[0][1];
    invoke(event);
    expect(handler).toHaveBeenCalledOnce();
    mainFrame.url = "http://127.0.0.1:5174/";
    expect(() => invoke(event)).toThrow(/Untrusted/);
  });
});
