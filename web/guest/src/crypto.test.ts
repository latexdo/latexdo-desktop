// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as desktop from "../../../electron/collabCrypto.js";
import { encodePeerInvite } from "../../../electron/peerInvite.js";
import * as web from "./crypto";
import { parseWebInvite } from "./invite";

const projectId = `project_${"a".repeat(32)}`;
const token = `p${"a".repeat(32)}_${"b".repeat(43)}`;

describe("browser encryption", () => {
  it("opens what the desktop app sealed, and the other way round", async () => {
    const key = desktop.newProjectKey();
    const plain = new TextEncoder().encode("\\section{Intro} é ✓");
    const fromDesktop = await desktop.encryptBytes(key, projectId, "text", plain);
    expect(await web.decryptBytes(key, projectId, "text", fromDesktop)).toEqual(plain);
    const fromWeb = await web.encryptBytes(key, projectId, "cursor", plain);
    expect(
      new Uint8Array(await desktop.decryptBytes(key, projectId, "cursor", fromWeb)),
    ).toEqual(plain);

    const name = await desktop.encryptString(key, "", "name", "Ada Lovelace");
    expect(await web.decryptString(key, "", "name", name)).toBe("Ada Lovelace");
    const webName = await web.encryptString(key, "", "name", "Émile");
    expect(await desktop.decryptString(key, "", "name", webName)).toBe("Émile");
  });

  it("refuses another key, project, kind or tampered data", async () => {
    const key = desktop.newProjectKey();
    const sealed = await web.encryptBytes(
      key,
      projectId,
      "file",
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      web.decryptBytes(desktop.newProjectKey(), projectId, "file", sealed),
    ).rejects.toThrow();
    await expect(
      web.decryptBytes(key, `project_${"c".repeat(32)}`, "file", sealed),
    ).rejects.toThrow();
    await expect(web.decryptBytes(key, projectId, "text", sealed)).rejects.toThrow();
    const tampered = sealed.slice();
    tampered[tampered.length - 1]! ^= 1;
    await expect(web.decryptBytes(key, projectId, "file", tampered)).rejects.toThrow();
  });

  it("round-trips large files through base64", () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
    expect(web.base64ToBytes(web.bytesToBase64(bytes))).toEqual(bytes);
    expect(web.base64ToBytes(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
  });
});

describe("web invite links", () => {
  it("reads the desktop invite from a link's fragment or as pasted", () => {
    const key = desktop.newProjectKey();
    const code = encodePeerInvite({
      token,
      addresses: ["https://collab.latexdo.org"],
      key,
    });
    const link = `https://collab.latexdo.org/join#${code.slice("latexdo-invite:".length)}`;
    const expected = { token, key, projectId };
    expect(parseWebInvite(new URL(link).hash)).toEqual(expected);
    expect(parseWebInvite(link)).toEqual(expected);
    expect(parseWebInvite(code)).toEqual(expected);
  });

  it("rejects links without a key or with a bad token", () => {
    const withoutKey = encodePeerInvite({
      token,
      addresses: ["https://collab.latexdo.org"],
    }).slice("latexdo-invite:".length);
    expect(parseWebInvite(`#${withoutKey}`)).toBeNull();
    expect(parseWebInvite("#not-an-invite")).toBeNull();
    expect(parseWebInvite("")).toBeNull();
    expect(parseWebInvite("#<script>")).toBeNull();
  });
});
