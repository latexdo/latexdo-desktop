import { beforeEach, describe, expect, it } from "vitest";
import {
  collaborationClientId,
  collaborationIdentity,
  collaborationSessionId,
  forgetShareToken,
  rememberShareToken,
  shareTokenForProject,
} from "./collaborationStorage";
import { collaboratorLook } from "./collaboratorLook";

beforeEach(() => window.localStorage.clear());

describe("collaboration ids", () => {
  it("creates stable session and client ids once", () => {
    const session = collaborationSessionId();
    const client = collaborationClientId();
    expect(session).toMatch(/^session-[0-9a-f-]{36}$/);
    expect(client).toMatch(/^client-[0-9a-f-]{36}$/);
    expect(collaborationSessionId()).toBe(session);
    expect(collaborationClientId()).toBe(client);
    expect(window.localStorage.getItem("latexdo.cloud.session")).toBe(session);
  });

  it("derives identity look from the client id and trims the stored name", () => {
    window.localStorage.setItem("latexdo.cloud.client", "client-fixed");
    window.localStorage.setItem("latexdo.cloud.clientName", `  ${"n".repeat(100)}  `);
    const identity = collaborationIdentity();
    expect(identity.clientName).toBe("n".repeat(80));
    expect({ color: identity.color, emoji: identity.emoji }).toEqual({
      color: collaboratorLook("client-fixed").color,
      emoji: collaboratorLook("client-fixed").emoji,
    });
  });

  it("uses an empty name when none is stored", () => {
    expect(collaborationIdentity().clientName).toBe("");
  });
});

describe("share tokens", () => {
  it("stores tokens per project and per server origin", () => {
    rememberShareToken("p1", "local-token");
    rememberShareToken("p1", "remote-token", "https://collab.example.com/api/x");
    expect(shareTokenForProject("p1")).toBe("local-token");
    expect(shareTokenForProject("p1", "https://collab.example.com")).toBe("remote-token");
    expect(shareTokenForProject("p2")).toBeUndefined();
  });

  it("treats invalid origins as the local server", () => {
    rememberShareToken("p1", "tok", "not a url");
    expect(shareTokenForProject("p1")).toBe("tok");
  });

  it("forgets a token", () => {
    rememberShareToken("p1", "tok");
    forgetShareToken("p1");
    expect(shareTokenForProject("p1")).toBeUndefined();
  });

  it("migrates a legacy token into the per-origin store", () => {
    window.localStorage.setItem(
      "latexdo.cloud.shareTokens",
      JSON.stringify({ p1: "  legacy  ", p2: 5, p3: "  " }),
    );
    expect(shareTokenForProject("p1")).toBe("legacy");
    window.localStorage.removeItem("latexdo.cloud.shareTokens");
    expect(shareTokenForProject("p1")).toBe("legacy");
    window.localStorage.setItem(
      "latexdo.cloud.shareTokens",
      JSON.stringify({ p2: 5, p3: "  " }),
    );
    expect(shareTokenForProject("p2")).toBeUndefined();
    expect(shareTokenForProject("p3")).toBeUndefined();
  });

  it("ignores a corrupt legacy store", () => {
    window.localStorage.setItem("latexdo.cloud.shareTokens", "{oops");
    expect(shareTokenForProject("p1")).toBeUndefined();
  });
});
