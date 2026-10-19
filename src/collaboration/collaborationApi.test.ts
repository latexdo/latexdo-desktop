import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CollaborationApiError,
  alwaysOnCollaborationOrigin,
  collaborationApiBaseUrl,
  collaborationHeaders,
  collaborationShareUrl,
  collaborationWebSocketUrl,
  isAlwaysOnCollaborationServer,
  projectShareToken,
} from "./collaborationApi";
import { rememberShareToken } from "./collaborationStorage";
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
    vi.unstubAllEnvs();
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

  it("sends the stored display name in headers", () => {
    window.localStorage.setItem("latexdo.cloud.clientName", " Grace ");
    expect(collaborationHeaders()["x-latexdo-client-name"]).toBe("Grace");
  });

  it("reaches projects on someone's computer through the desktop bridge", async () => {
    const usesCollaborationBridge = vi.fn(() => true);
    vi.stubGlobal("latexdo", { usesCollaborationBridge });
    const url = new URL(
      await collaborationWebSocketUrl(roomOptions({ apiBaseUrl: "peer:abc", clientName: "" })),
    );
    expect(usesCollaborationBridge).toHaveBeenCalledWith("peer:abc");
    expect(url.host).toBe("peer.invalid");
    expect(url.protocol).toBe("ws:");
    expect(url.searchParams.has("name")).toBe(false);
    expect(url.searchParams.has("share")).toBe(false);
  });

  it("uses a remembered share token for the server", async () => {
    rememberShareToken("project 1", "remembered", "https://collab.example.org");
    const url = new URL(await collaborationWebSocketUrl(roomOptions()));
    expect(url.searchParams.get("share")).toBe("remembered");
    expect(projectShareToken("project 1", "explicit", "https://collab.example.org")).toBe(
      "explicit",
    );
  });
});

describe("collaboration server configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("recognizes only the always-on server origin", () => {
    expect(alwaysOnCollaborationOrigin).toMatch(/^https?:\/\//);
    expect(isAlwaysOnCollaborationServer(alwaysOnCollaborationOrigin)).toBe(true);
    expect(isAlwaysOnCollaborationServer("https://elsewhere.example")).toBe(false);
    expect(isAlwaysOnCollaborationServer(undefined)).toBe(false);
    expect(isAlwaysOnCollaborationServer("")).toBe(false);
  });

  it("normalizes the configured API base URL to its origin", () => {
    vi.stubEnv("VITE_LATEXDO_API_BASE_URL", " https://api.example.org/v1/ ");
    expect(collaborationApiBaseUrl()).toBe("https://api.example.org");
    vi.stubEnv("VITE_LATEXDO_API_BASE_URL", "");
    expect(collaborationApiBaseUrl()).toBe("");
    vi.stubEnv("VITE_LATEXDO_API_BASE_URL", undefined);
    expect(collaborationApiBaseUrl()).toBe("");
  });

  it("builds a share link from the current page", () => {
    expect(collaborationShareUrl("a b/c")).toBe(
      `${window.location.origin}${window.location.pathname}#share=a%20b%2Fc`,
    );
  });

  it("carries the HTTP status on API errors", () => {
    const error = new CollaborationApiError(403, "Forbidden");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "CollaborationApiError", status: 403, message: "Forbidden" });
  });
});
