// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodePeerInvite,
  encodePeerInvite,
  looksLikePeerInvite,
  normalizePeerOrigin,
  peerInvitePrefix,
} from "./peerInvite.js";

const token = "a".repeat(43);

describe("peer invites", () => {
  it("round-trips a token with its addresses and survives chat line wrapping", () => {
    const invite = encodePeerInvite({
      token,
      addresses: [
        "https://calm-river.trycloudflare.com/ignored?x=1",
        "http://10.0.0.4:5000",
      ],
    });
    expect(invite.startsWith(peerInvitePrefix)).toBe(true);
    expect(looksLikePeerInvite(` ${invite}`)).toBe(true);
    const wrapped = `${invite.slice(0, 30)}\n  ${invite.slice(30)}\n`;
    expect(decodePeerInvite(wrapped)).toEqual({
      token,
      addresses: ["https://calm-river.trycloudflare.com", "http://10.0.0.4:5000"],
    });
  });

  it("refuses to build an invite without a usable token or address", () => {
    expect(() =>
      encodePeerInvite({ token: "short", addresses: ["http://a"] }),
    ).toThrow();
    expect(() => encodePeerInvite({ token, addresses: ["ftp://a"] })).toThrow();
  });

  it.each([
    undefined,
    "",
    "plain-token",
    `${peerInvitePrefix}!!!`,
    `${peerInvitePrefix}${Buffer.from("[]").toString("base64url")}`,
    `${peerInvitePrefix}${Buffer.from(JSON.stringify({ v: 2, t: token, a: ["http://a"] })).toString("base64url")}`,
    `${peerInvitePrefix}${Buffer.from(JSON.stringify({ v: 1, t: "x", a: ["http://a"] })).toString("base64url")}`,
    `${peerInvitePrefix}${Buffer.from(JSON.stringify({ v: 1, t: token, a: ["file:///etc"] })).toString("base64url")}`,
    `${peerInvitePrefix}${Buffer.from(JSON.stringify({ v: 1, t: token, a: "http://a" })).toString("base64url")}`,
    `${peerInvitePrefix}${"A".repeat(5000)}`,
  ])("rejects malformed invite %#", (input) => {
    expect(decodePeerInvite(input)).toBeNull();
  });

  it("only accepts plain http(s) origins as addresses", () => {
    expect(normalizePeerOrigin("https://host.example:8443/path")).toBe(
      "https://host.example:8443",
    );
    expect(normalizePeerOrigin("https://user:pw@host.example")).toBeNull();
    expect(normalizePeerOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizePeerOrigin(42)).toBeNull();
    expect(looksLikePeerInvite(42)).toBe(false);
  });
});
