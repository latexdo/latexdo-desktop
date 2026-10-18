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
});
