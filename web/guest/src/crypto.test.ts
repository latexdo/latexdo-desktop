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

describe("browser encryption input checks", () => {
  it("rejects invalid keys, short or foreign payloads and plain strings", async () => {
    const key = desktop.newProjectKey();
    await expect(
      web.encryptBytes("short", projectId, "text", new Uint8Array([1])),
    ).rejects.toThrow("Invalid project key.");
    await expect(
      web.decryptBytes(key, projectId, "text", new Uint8Array(10)),
    ).rejects.toThrow("Not an encrypted LatexDo payload.");
    const wrongVersion = await web.encryptBytes(key, projectId, "text", new Uint8Array([1]));
    wrongVersion[0] = 2;
    await expect(web.decryptBytes(key, projectId, "text", wrongVersion)).rejects.toThrow(
      "Not an encrypted LatexDo payload.",
    );
    await expect(web.decryptString(key, "", "name", "plain")).rejects.toThrow(
      "Not an encrypted LatexDo string.",
    );
    expect(web.isEncryptedString(42)).toBe(false);
  });
});

describe("web invite edge cases", () => {
  it("rejects over-long codes, other versions and unknown share tokens", () => {
    const key = desktop.newProjectKey();
    const encode = (value: unknown) =>
      web.bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
    expect(parseWebInvite("a".repeat(4097))).toBeNull();
    expect(parseWebInvite(encode({ v: 2, t: token, k: key }))).toBeNull();
    expect(parseWebInvite(encode({ v: 1, t: 5, k: key }))).toBeNull();
    expect(parseWebInvite(encode({ v: 1, t: "not-a-token", k: key }))).toBeNull();
    expect(parseWebInvite(encode({ v: 1, t: token, k: key }))).toEqual({
      token,
      key,
      projectId,
    });
  });
});
