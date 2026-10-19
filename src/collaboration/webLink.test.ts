// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encodePeerInvite } from "../../electron/peerInvite";
import { webLinkForInvite } from "./webLink";

const token = `p${"a".repeat(32)}_${"b".repeat(43)}`;
const key = "k".repeat(43);

describe("webLinkForInvite", () => {
  it("links always-on projects to the server's web editor", () => {
    const invite = encodePeerInvite({
      token,
      addresses: ["https://collab.latexdo.org"],
      key,
    });
    expect(webLinkForInvite(invite)).toBe(
      `https://collab.latexdo.org/join#${invite.slice("latexdo-invite:".length)}`,
    );
  });

  it("has no web link for projects hosted on someone's computer", () => {
    const invite = encodePeerInvite({ token, addresses: ["http://192.168.1.4:8787"] });
    expect(webLinkForInvite(invite)).toBeNull();
    expect(webLinkForInvite(undefined)).toBeNull();
    expect(webLinkForInvite("latexdo-invite:%%%")).toBeNull();
  });

  const raw = (payload: unknown) =>
    "latexdo-invite:" +
    btoa(typeof payload === "string" ? payload : JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  it("rejects payloads that are not objects, lack an address or are malformed", () => {
    expect(webLinkForInvite(raw("null"))).toBeNull();
    expect(webLinkForInvite(raw("42"))).toBeNull();
    expect(webLinkForInvite(raw("{not json"))).toBeNull();
    expect(webLinkForInvite(raw({ k: key, a: [1, null] }))).toBeNull();
    expect(webLinkForInvite(raw({ k: key, a: "https://x.org" }))).toBeNull();
    expect(webLinkForInvite(raw({ k: 1, a: ["https://x.org"] }))).toBeNull();
    expect(webLinkForInvite(raw({ k: key, a: ["not a url"] }))).toBeNull();
    expect(webLinkForInvite(raw({ k: key, a: ["http://example.org"] }))).toBeNull();
  });

  it("allows plain http for a localhost server and ignores whitespace", () => {
    const invite = raw({ k: key, a: [7, "http://localhost:8787/x"] });
    const spaced = invite.slice(0, 20) + " \n " + invite.slice(20);
    expect(webLinkForInvite(spaced)).toBe(
      `http://localhost:8787/join#${invite.slice("latexdo-invite:".length)}`,
    );
  });
});
