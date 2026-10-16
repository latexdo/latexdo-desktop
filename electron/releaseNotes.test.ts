import { generateKeyPairSync, createHash, createPublicKey, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  fetchReleaseNotesIndex,
  isApprovedReleaseNotesDocumentUrl,
  isApprovedReleaseNotesFetchUrl,
  isApprovedReleaseNotesOrigin,
  isReleaseNotesVersion,
  parseReleaseNotesDocument,
  parseReleaseNotesIndex,
  releaseNotesUrlForVersion,
  releasesInRange,
  resolveReleaseNotes,
  resolveReleaseNotesRange,
  sha256HexOfText,
  trustedReleaseNotesFromText,
  verifyReleaseNotesSignature,
  type ReleaseNotesDocument,
  type ReleaseNotesIndex,
} from "./releaseNotes.js";

const testBaseUrl = "https://latexdo.org/updates/release-notes";

let dataDirectories: string[] = [];
let testKeyPair: {
  publicKeyPemPath: string;
  publicKeyPem: string;
  privateKey: string;
} | null = null;

let keyGeneration: Promise<{
  publicKeyPemPath: string;
  publicKeyPem: string;
  privateKey: string;
}> | null = null;

async function makeTestKeyPair(): Promise<{
  publicKeyPemPath: string;
  publicKeyPem: string;
  privateKey: string;
}> {
  if (testKeyPair) return testKeyPair;
  if (keyGeneration) return keyGeneration;
  keyGeneration = (async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "latexdo-release-notes-key-"),
    );
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    const publicKeyPemPath = path.join(directory, "update-public-key.pem");
    await writeFile(publicKeyPemPath, publicKeyPem);
    const pair = {
      publicKeyPemPath,
      publicKeyPem,
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    };
    testKeyPair = pair;
    return pair;
  })();
  return keyGeneration;
}

function keyIdOf(publicKeyPem: string): string {
  const publicKeyObject = createPublicKey(publicKeyPem);
  return createHash("sha256")
    .update(publicKeyObject.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);
}

function signPayload(payload: Record<string, unknown>): string {
  const keyPair = testKeyPair;
  if (!keyPair) throw new Error("Test key pair not initialized.");
  const unsigned = { ...payload };
  delete unsigned.signature;
  return sign(
    null,
    Buffer.from(canonicalJson(unsigned), "utf8"),
    keyPair.privateKey,
  ).toString("base64");
}

function signedPayload(
  payload: Record<string, unknown>,
  value: string | null = null,
): Record<string, unknown> {
  const keyPair = testKeyPair;
  if (!keyPair) throw new Error("Test key pair not initialized.");
  return {
    ...payload,
    signature: {
      algorithm: "ed25519",
      keyId: keyIdOf(keyPair.publicKeyPem),
      value: value ?? signPayload(payload),
    },
  };
}

function createKeyPairForTamper(): { publicKeyPem: string } {
  const { publicKey } = generateKeyPairSync("ed25519");
  return { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string };
}

function documentPayload(version: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    product: "LatexDo",
    version,
    title: `LatexDo ${version}`,
    summary: `Highlights of ${version}.`,
    publishedAt: "2026-03-01T12:00:00.000Z",
    releaseUrl: `https://latexdo.org/downloads/`,
    highlights: [
      {
        id: "latex-reengines",
        category: "compiler",
        title: "Reworked compilation",
        description: "Faster recompilation for large documents.",
      },
    ],
    fixes: ["Fixed intermittent citations breakage."],
    breakingChanges: [],
  };
}

function indexPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    product: "LatexDo",
    releases: ["0.2.0", "0.3.0", "0.4.0", "0.5.0"].map((version) => ({
      version,
      publishedAt: "2026-03-01T12:00:00.000Z",
      releaseNotesUrl: `${testBaseUrl}/${version}.json`,
      sha256: null,
    })),
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-release-notes-"));
  dataDirectories.push(directory);
  return directory;
}

beforeEach(async () => {
  dataDirectories = [];
  await makeTestKeyPair();
});

afterEach(async () => {
  await Promise.all(
    dataDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function notesFetcher(
  responses: Record<string, string>,
  onFetch: (url: string) => void = () => undefined,
) {
  return async (url: string): Promise<string> => {
    onFetch(url);
    const value = responses[url];
    if (value === undefined) {
      throw new Error(`Unexpected fetch of ${url}`);
    }
    return value;
  };
}

describe("validation helpers", () => {
  it("accepts only https hosts on the approved hostname list", () => {
    expect(isApprovedReleaseNotesOrigin("https://latexdo.org")).toBe(true);
    expect(isApprovedReleaseNotesOrigin("https://www.latexdo.org")).toBe(true);
    expect(isApprovedReleaseNotesOrigin("http://latexdo.org")).toBe(false);
    expect(isApprovedReleaseNotesOrigin("https://evil.example")).toBe(false);
  });

  it("accepts fetch URLs under the release-notes path only", () => {
    expect(isApprovedReleaseNotesFetchUrl(`${testBaseUrl}/0.3.0.json`)).toBe(true);
    expect(isApprovedReleaseNotesFetchUrl(`${testBaseUrl}/index.json`)).toBe(true);
    expect(
      isApprovedReleaseNotesFetchUrl("https://latexdo.org/downloads/0.3.0.json"),
    ).toBe(false);
    expect(isApprovedReleaseNotesFetchUrl("https://evil.example/x.json")).toBe(false);
  });

  it("accepts document link URLs on approved hostnames", () => {
    expect(isApprovedReleaseNotesDocumentUrl("https://latexdo.org/downloads/")).toBe(
      true,
    );
    expect(
      isApprovedReleaseNotesDocumentUrl("https://github.com/latexdo/latexdo/releases"),
    ).toBe(true);
    expect(isApprovedReleaseNotesDocumentUrl("https://evil.example/")).toBe(false);
  });

  it("recognizes semantic release versions", () => {
    expect(isReleaseNotesVersion("0.3.0")).toBe(true);
    expect(isReleaseNotesVersion("v0.3.0")).toBe(true);
    expect(isReleaseNotesVersion("0.3.0-beta.1")).toBe(true);
    expect(isReleaseNotesVersion("latest")).toBe(false);
    expect(isReleaseNotesVersion("0.3")).toBe(false);
  });

  it("builds version-derived URLs without duplication", () => {
    expect(releaseNotesUrlForVersion(testBaseUrl, "0.3.0")).toBe(
      `${testBaseUrl}/0.3.0.json`,
    );
    expect(releaseNotesUrlForVersion(`${testBaseUrl}/`, "v0.3.0")).toBe(
      `${testBaseUrl}/0.3.0.json`,
    );
  });

  it("produces stable canonical JSON", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      '{"a":[2,{"c":4,"d":3}],"b":1}',
    );
  });

  it("computes sha256 hex digests", async () => {
    expect(await sha256HexOfText("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("document parsing", () => {
  it("parses a valid document", () => {
    const parsed = parseReleaseNotesDocument(documentPayload("0.3.0"));
    expect(parsed?.version).toBe("0.3.0");
    expect(parsed?.highlights[0].category).toBe("compiler");
    expect(parsed?.signature).toBeUndefined();
  });

  it("rejects unknown highlight categories", () => {
    const payload = documentPayload("0.3.0");
    payload.highlights = [{ id: "x", category: "bogus", title: "X", description: "" }];
    expect(parseReleaseNotesDocument(payload)).toBeNull();
  });

  it("rejects non-approved document links", () => {
    const payload = documentPayload("0.3.0");
    payload.releaseUrl = "https://evil.example/";
    expect(parseReleaseNotesDocument(payload)).toBeNull();
  });

  it("rejects version mismatches with the path", () => {
    const payload = documentPayload("0.3.0");
    expect(parseReleaseNotesDocument(payload)).not.toBeNull();
  });
});

describe("index parsing", () => {
  it("parses a signed index", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const payload = signedPayload(indexPayload());
    const index = parseReleaseNotesIndex(payload);
    expect(index?.releases).toHaveLength(4);
    expect(await verifyReleaseNotesSignature(payload, publicKeyPemPath)).toBe(true);
  });

  it("rejects an unsigned index", async () => {
    const payload = indexPayload();
    const { publicKeyPemPath } = await makeTestKeyPair();
    expect(await verifyReleaseNotesSignature(payload, publicKeyPemPath)).toBe(false);
  });
});

describe("trusted document resolution", () => {
  it("accepts a signed document", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const raw = JSON.stringify(signedPayload(documentPayload("0.3.0")));
    const document = await trustedReleaseNotesFromText(raw, {
      publicKeyPemPath,
      pinnedSha256: null,
      expectedVersion: "0.3.0",
    });
    expect(document).not.toBeNull();
  });

  it("accepts a pinned document without a usable signature", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const raw = JSON.stringify(documentPayload("0.3.0"));
    const pinnedSha256 = await sha256HexOfText(raw);
    const document = await trustedReleaseNotesFromText(raw, {
      publicKeyPemPath,
      pinnedSha256,
      expectedVersion: "0.3.0",
    });
    expect(document).not.toBeNull();
  });

  it("rejects a document that does not match its pin", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const document = await trustedReleaseNotesFromText(
      JSON.stringify(documentPayload("0.3.0")),
      {
        publicKeyPemPath,
        pinnedSha256: "a".repeat(64),
        expectedVersion: "0.3.0",
      },
    );
    expect(document).toBeNull();
  });

  it("rejects a document for the wrong version", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const document = await trustedReleaseNotesFromText(
      JSON.stringify(signedPayload(documentPayload("0.3.0"))),
      {
        publicKeyPemPath,
        pinnedSha256: null,
        expectedVersion: "0.4.0",
      },
    );
    expect(document).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const payload = signedPayload(documentPayload("0.3.0"));
    payload.highlights = [];
    expect(await verifyReleaseNotesSignature(payload, publicKeyPemPath)).toBe(false);
  });

  it("rejects an unknown signature key", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const different = createKeyPairForTamper();
    const document = await trustedReleaseNotesFromText(
      JSON.stringify({
        ...documentPayload("0.3.0"),
        signature: {
          algorithm: "ed25519",
          keyId: keyIdOf(different.publicKeyPem),
          value: `${"A".repeat(86)}=`,
        },
      }),
      {
        publicKeyPemPath,
        pinnedSha256: null,
        expectedVersion: "0.3.0",
      },
    );
    expect(document).toBeNull();
  });
});

describe("resolveReleaseNotes", () => {
  it("fetches, verifies, and caches a signed document", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const raw = JSON.stringify(signedPayload(documentPayload("0.3.0")));
    const fetched: string[] = [];
    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: notesFetcher({ [`${testBaseUrl}/0.3.0.json`]: raw }, (url) =>
        fetched.push(url),
      ),
    };

    const document = await resolveReleaseNotes(options, "0.3.0", null);
    expect(document?.version).toBe("0.3.0");
    expect(fetched).toEqual([`${testBaseUrl}/0.3.0.json`]);

    const cached = await resolveReleaseNotes(options, "0.3.0", null);
    expect(cached?.version).toBe("0.3.0");
    expect(fetched).toHaveLength(1);

    const persisted = await readFile(
      path.join(directory, "releases", "0.3.0.json"),
      "utf8",
    );
    expect(JSON.parse(persisted).version).toBe("0.3.0");
  });

  it("prefers an index reference URL and honors its pin", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const raw = JSON.stringify(documentPayload("0.3.0"));
    const pin = await sha256HexOfText(raw);
    const parsedIndex = parseReleaseNotesIndex(signedPayload(indexPayload()));
    expect(parsedIndex).not.toBeNull();
    const pinnedIndex: ReleaseNotesIndex = {
      ...parsedIndex!,
      releases: parsedIndex!.releases.map((entry) =>
        entry.version === "0.3.0" ? { ...entry, sha256: pin } : entry,
      ),
    };
    const signedIndex = signedPayload(
      pinnedIndex as unknown as Record<string, unknown>,
    );

    const fetched: string[] = [];
    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: notesFetcher({ [`${testBaseUrl}/0.3.0.json`]: raw }, (url) =>
        fetched.push(url),
      ),
    };

    const document = await resolveReleaseNotes(
      options,
      "0.3.0",
      parseReleaseNotesIndex(signedIndex),
    );
    expect(document?.version).toBe("0.3.0");
    expect(fetched).toEqual([`${testBaseUrl}/0.3.0.json`]);
  });

  it("returns null when a pin mismatches", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const raw = JSON.stringify(signedPayload(documentPayload("0.3.0")));
    const parsedIndex = parseReleaseNotesIndex(signedPayload(indexPayload()));
    expect(parsedIndex).not.toBeNull();
    const mismatchedIndex: ReleaseNotesIndex | null = parsedIndex
      ? {
          ...parsedIndex,
          releases: parsedIndex.releases.map((entry) =>
            entry.version === "0.3.0" ? { ...entry, sha256: "b".repeat(64) } : entry,
          ),
        }
      : null;

    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: notesFetcher({ [`${testBaseUrl}/0.3.0.json`]: raw }),
    };
    const document = await resolveReleaseNotes(options, "0.3.0", mismatchedIndex);
    expect(document).toBeNull();
  });

  it("returns null when the fetch fails", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: async () => {
        throw new Error("offline");
      },
    };
    expect(await resolveReleaseNotes(options, "0.3.0", null)).toBeNull();
  });
});

describe("fetchReleaseNotesIndex", () => {
  it("rejects an unsigned index", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: notesFetcher({
        [`${testBaseUrl}/index.json`]: JSON.stringify(indexPayload()),
      }),
    };
    expect(await fetchReleaseNotesIndex(options)).toBeNull();
  });

  it("accepts and caches a signed index, then reuses the cache", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const fetched: string[] = [];
    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: notesFetcher(
        {
          [`${testBaseUrl}/index.json`]: JSON.stringify(signedPayload(indexPayload())),
        },
        (url) => fetched.push(url),
      ),
    };
    expect((await fetchReleaseNotesIndex(options))?.releases).toHaveLength(4);
    expect((await fetchReleaseNotesIndex(options))?.releases).toHaveLength(4);
    expect(fetched).toHaveLength(1);
  });
});

describe("release ranges", () => {
  it("filters and orders releases within the range", () => {
    const index = parseReleaseNotesIndex(signedPayload(indexPayload()));
    expect(index).not.toBeNull();
    const range = releasesInRange(index!.releases, "0.2.0", "0.4.0").map(
      (entry) => entry.version,
    );
    expect(range).toEqual(["0.4.0", "0.3.0"]);
  });

  it("excludes the from version and future versions beyond the target", () => {
    const index = parseReleaseNotesIndex(signedPayload(indexPayload()));
    const range = releasesInRange(index!.releases, "0.3.0", "0.4.0").map(
      (entry) => entry.version,
    );
    expect(range).toEqual(["0.4.0"]);
  });

  it("resolves every release between two versions", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const responses: Record<string, string> = {
      [`${testBaseUrl}/index.json`]: JSON.stringify(signedPayload(indexPayload())),
    };
    for (const version of ["0.3.0", "0.4.0", "0.5.0"]) {
      responses[`${testBaseUrl}/${version}.json`] = JSON.stringify(
        signedPayload(documentPayload(version)),
      );
    }
    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: notesFetcher(responses),
    };

    const result = await resolveReleaseNotesRange(options, "0.2.0", "0.4.0");
    expect(result.available).toBe(true);
    expect(result.documents.map((document) => document.version)).toEqual([
      "0.4.0",
      "0.3.0",
    ]);
  });

  it("marks unavailable when the target version cannot be verified", async () => {
    const { publicKeyPemPath } = await makeTestKeyPair();
    const directory = await temporaryDirectory();
    const options = {
      dataDirectory: directory,
      publicKeyPemPath,
      baseUrl: testBaseUrl,
      fetch: async (url: string) => {
        if (url.endsWith("/index.json")) {
          return JSON.stringify(signedPayload(indexPayload()));
        }
        if (url.includes("0.4.0")) throw new Error("offline");
        return JSON.stringify(signedPayload(documentPayload("0.3.0")));
      },
    };
    const result = await resolveReleaseNotesRange(options, "0.2.0", "0.4.0");
    expect(result.available).toBe(false);
    expect(result.documents.map((document) => document.version)).toEqual(["0.3.0"]);
  });
});
