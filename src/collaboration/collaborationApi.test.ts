import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collaborationHeaders, collaborationWebSocketUrl } from "./collaborationApi";
import type { CollaborationRoomOptions } from "./collaborationTypes";

function roomOptions(
  overrides: Partial<CollaborationRoomOptions> = {},
): CollaborationRoomOptions {
  return {
    apiBaseUrl: "https://collab.example.org",
    projectId: "project 1",
    relativePath: "main.tex",
    clientName: "Ada Lovelace",
    color: "#2f6fdb",
    ...overrides,
  };
}

describe("collaboration authentication and WebSocket URLs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates one local identity and reuses it for authenticated headers", () => {
    const first = collaborationHeaders("share-secret");
    const second = collaborationHeaders();

    expect(first["x-latexdo-session"]).toMatch(/^session-/);
    expect(first["x-latexdo-client"]).toMatch(/^client-/);
    expect(first["x-latexdo-share-token"]).toBe("share-secret");
    expect(second["x-latexdo-session"]).toBe(first["x-latexdo-session"]);
    expect(second["x-latexdo-client"]).toBe(first["x-latexdo-client"]);
    expect(second["x-latexdo-share-token"]).toBeUndefined();
  });

  it("keeps the stored identity across calls", () => {
    window.localStorage.setItem("latexdo.cloud.session", "session-1");
    window.localStorage.setItem("latexdo.cloud.client", "client-1");

    expect(collaborationHeaders()).toMatchObject({
      "x-latexdo-session": "session-1",
      "x-latexdo-client": "client-1",
    });
  });

  it("connects with identity and share capability in the socket URL", async () => {
    window.localStorage.setItem("latexdo.cloud.session", "session-1");
    window.localStorage.setItem("latexdo.cloud.client", "client-1");
    const url = new URL(
      await collaborationWebSocketUrl(roomOptions({ shareToken: "share-secret" })),
    );

    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("collab.example.org");
    expect(url.pathname).toBe("/api/projects/project%201/files/collaborate");
    expect(url.searchParams.get("path")).toBe("main.tex");
    expect(url.searchParams.get("session")).toBe("session-1");
    expect(url.searchParams.get("clientId")).toBe("client-1");
    expect(url.searchParams.get("name")).toBe("Ada Lovelace");
    expect(url.searchParams.get("share")).toBe("share-secret");
  });

  it("connects HTTP development API URLs over WS", async () => {
    const url = new URL(
      await collaborationWebSocketUrl(
        roomOptions({ apiBaseUrl: "http://127.0.0.1:8787" }),
      ),
    );

    expect(url.protocol).toBe("ws:");
    expect(url.host).toBe("127.0.0.1:8787");
  });

  it("refuses to connect without a configured collaboration server", async () => {
    for (const apiBaseUrl of ["", "not a url", "ftp://example.com"]) {
      await expect(
        collaborationWebSocketUrl(roomOptions({ apiBaseUrl })),
      ).rejects.toThrow("No collaboration server is configured.");
    }
  });
});
