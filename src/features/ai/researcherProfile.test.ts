import { afterEach, describe, it, expect, vi } from "vitest";
import {
  generateScholarToken,
  scholarCodenameCombinationCount,
  tokenCodename,
  buildResearchContext,
  normalizeResearcherProfile,
  defaultResearcherProfile,
  displayNameWithTitle,
  providerDisplayNameWithTitle,
  suggestDisplayNameFromProviderUsername,
} from "./researcherProfile";

describe("generateScholarToken", () => {
  it("produces a cool-but-strong token: sch-<adj>-<noun>-<base32>", () => {
    const token = generateScholarToken();
    expect(token).toMatch(/^sch-[a-z]+-[a-z]+-[0-9A-HJKMNP-TV-Z]{20,}$/);
  });

  it("offers at least 1000 readable codename combinations", () => {
    expect(scholarCodenameCombinationCount).toBeGreaterThanOrEqual(1000);
  });

  it("uses an unambiguous alphabet (no I, L, O, U in the suffix)", () => {
    const suffix = generateScholarToken().split("-").slice(3).join("");
    expect(suffix).not.toMatch(/[ILOU]/);
  });

  it("is effectively unique across many draws", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateScholarToken));
    expect(tokens.size).toBe(500);
  });

  it("tokenCodename returns the memorable middle", () => {
    expect(tokenCodename("sch-cosmic-quokka-7F3KMQ2N9VXAB")).toBe("cosmic-quokka");
  });
});

describe("normalizeResearcherProfile", () => {
  it("always guarantees a token, even from empty input", () => {
    const p = normalizeResearcherProfile({});
    expect(p.token.length).toBeGreaterThan(10);
    expect(p.mode).toBe("anonymous");
  });

  it("preserves an existing token and clamps fields", () => {
    const p = normalizeResearcherProfile({
      mode: "orcid",
      token: "sch-lunar-otter-ABCDEF",
      orcidId: "0000-0002-1825-0097",
      title: "Dr",
      papers: [{ title: "Paper A", year: "2021" }, { title: "" }],
      externalProviders: [
        {
          provider: "zotero",
          username: "omarabedelkader",
          displayName: "Abedelkader",
          title: "Dr",
          confirmed: true,
          connectedAt: 1,
          updatedAt: 2,
        },
      ],
    });
    expect(p.token).toBe("sch-lunar-otter-ABCDEF");
    expect(p.orcidId).toBe("0000-0002-1825-0097");
    expect(p.title).toBe("Dr");
    expect(p.papers).toHaveLength(1); // empty-title paper dropped
    expect(p.externalProviders[0]).toMatchObject({
      provider: "zotero",
      username: "omarabedelkader",
      displayName: "Abedelkader",
      title: "Dr",
      confirmed: true,
    });
  });

  it("drops invalid provider connections and keeps usernames distinct from display names", () => {
    const p = normalizeResearcherProfile({
      externalProviders: [
        {
          provider: "unknown",
          username: "bad",
        },
        {
          provider: "overleaf",
          username: "omarabedelkader",
          displayName: "Abedelkader",
          title: "Prof",
          confirmed: false,
        },
      ],
    });
    expect(p.externalProviders).toHaveLength(1);
    expect(p.externalProviders[0].username).toBe("omarabedelkader");
    expect(providerDisplayNameWithTitle(p.externalProviders[0])).toBe(
      "Prof Abedelkader",
    );
  });
});

describe("profile display names", () => {
  it("formats academic titles separately from account usernames", () => {
    expect(
      displayNameWithTitle({
        title: "Dr",
        displayName: "Abedelkader",
      }),
    ).toBe("Dr Abedelkader");
  });

  it("suggests a confirmable display name from a provider username", () => {
    expect(suggestDisplayNameFromProviderUsername("omarabedelkader")).toBe(
      "Abedelkader",
    );
    expect(suggestDisplayNameFromProviderUsername("ada_lovelace")).toBe("Ada Lovelace");
  });
});

describe("buildResearchContext", () => {
  it("returns null when disabled", () => {
    expect(
      buildResearchContext({
        ...defaultResearcherProfile,
        includeInContext: false,
      }),
    ).toBeNull();
  });

  it("summarizes name, affiliation and papers for the agent", () => {
    const context = buildResearchContext({
      ...defaultResearcherProfile,
      mode: "orcid",
      orcidId: "0000-0002-1825-0097",
      displayName: "Ada Lovelace",
      title: "Prof",
      affiliation: "Analytical Engine Lab",
      papers: [{ title: "Notes on the Engine", year: "1843" }],
      includeInContext: true,
    });
    expect(context).toContain("Prof Ada Lovelace");
    expect(context).toContain("Analytical Engine Lab");
    expect(context).toContain("Notes on the Engine");
    expect(context).toContain("1843");
  });
});

describe("token randomness sources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects out-of-range draws so codenames stay uniformly distributed", () => {
    let call = 0;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        call += 1;
        // Call 1 is the suffix; call 2 is the first codename draw, which
        // lands above the largest multiple of the list size and is redrawn.
        bytes.fill(call === 2 ? 0xff : 0);
        return bytes;
      },
    });
    const token = generateScholarToken();
    expect(token).toBe(`sch-stellar-atlas-${"0".repeat(26)}`);
    expect(call).toBe(4);
  });

  it("falls back to Math.random without Web Crypto", () => {
    vi.stubGlobal("crypto", {});
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(generateScholarToken()).toBe(`sch-stellar-atlas-${"0".repeat(26)}`);
    expect(random).toHaveBeenCalled();
  });
});

describe("profile normalisation edge cases", () => {
  it("returns a token unchanged when it has no codename", () => {
    expect(tokenCodename("plain")).toBe("plain");
  });

  it("builds the default anonymous profile from nothing", () => {
    const profile = normalizeResearcherProfile(null);
    expect(profile).toMatchObject({
      mode: "anonymous",
      title: "",
      externalProviders: [],
      papers: [],
      papersFetchedAt: 0,
      includeInContext: true,
    });
    expect(profile.token).toMatch(/^sch-/);
  });

  it("keeps valid saved fields and drops invalid ones", () => {
    const profile = normalizeResearcherProfile({
      mode: "orcid",
      token: "sch-a-b-C",
      title: "Baron",
      papersFetchedAt: 42,
      includeInContext: false,
      papers: [
        null,
        "paper",
        { title: "" },
        { title: "Kept", year: "2020", doi: "10.1/x", journal: "J" },
        { title: "Bare", year: 2020 },
      ],
    });
    expect(profile.mode).toBe("orcid");
    expect(profile.token).toBe("sch-a-b-C");
    expect(profile.title).toBe("");
    expect(profile.papersFetchedAt).toBe(42);
    expect(profile.includeInContext).toBe(false);
    expect(profile.papers).toEqual([
      { title: "Kept", year: "2020", doi: "10.1/x", journal: "J" },
      { title: "Bare", year: undefined, doi: undefined, journal: undefined },
    ]);
    expect(normalizeResearcherProfile({ papers: "nope" }).papers).toEqual([]);
  });

  it("normalises external provider connections", () => {
    vi.spyOn(Date, "now").mockReturnValue(777);
    const profile = normalizeResearcherProfile({
      externalProviders: [
        null,
        "zotero",
        { provider: "github", username: "x" },
        { provider: "zotero", username: "   " },
        {
          provider: "zotero",
          username: " Ada ",
          displayName: " Ada L ",
          title: "Dr",
          affiliation: " Lab ",
          confirmed: true,
          connectedAt: 5,
          updatedAt: 9,
          projectFetchUrl: " https://example.org/p ",
        },
        { provider: "zotero", username: "ada" },
        {
          provider: "overleaf",
          username: "grace",
          connectedAt: Number.NaN,
          updatedAt: Number.POSITIVE_INFINITY,
          projectFetchUrl: "   ",
          affiliation: "  ",
        },
      ],
    });
    expect(profile.externalProviders).toEqual([
      {
        provider: "zotero",
        username: "Ada",
        displayName: "Ada L",
        title: "Dr",
        affiliation: "Lab",
        confirmed: true,
        connectedAt: 5,
        updatedAt: 9,
        projectFetchUrl: "https://example.org/p",
      },
      {
        provider: "overleaf",
        username: "grace",
        displayName: "",
        title: "",
        affiliation: undefined,
        confirmed: false,
        connectedAt: 777,
        updatedAt: 777,
        projectFetchUrl: undefined,
      },
    ]);
    expect(normalizeResearcherProfile({ externalProviders: {} }).externalProviders).toEqual(
      [],
    );
    vi.restoreAllMocks();
  });

  it("keeps at most twenty provider connections", () => {
    const profile = normalizeResearcherProfile({
      externalProviders: Array.from({ length: 25 }, (_, index) => ({
        provider: "mendeley",
        username: `user${index}`,
      })),
    });
    expect(profile.externalProviders).toHaveLength(20);
  });

  it("titles provider names and falls back to the username", () => {
    expect(
      providerDisplayNameWithTitle({ title: "Prof", displayName: "  ", username: " ada " }),
    ).toBe("Prof ada");
    expect(
      providerDisplayNameWithTitle({ title: "", displayName: "Ada", username: "ada" }),
    ).toBe("Ada");
    expect(displayNameWithTitle({ title: "Dr", displayName: "  " })).toBe("");
    expect(displayNameWithTitle({ title: "", displayName: "Ada" })).toBe("Ada");
  });

  it("suggests readable names from provider usernames", () => {
    expect(suggestDisplayNameFromProviderUsername("@@1234")).toBe("");
    expect(suggestDisplayNameFromProviderUsername("omarabedelkader")).toBe(
      "Abedelkader",
    );
    expect(suggestDisplayNameFromProviderUsername("jd_smith")).toBe("JD Smith");
  });

  it("omits empty context and lists ORCID and bare papers", () => {
    const base = normalizeResearcherProfile({ token: "sch-a-b-C" });
    expect(buildResearchContext(base)).toBeNull();
    expect(buildResearchContext({ ...base, displayName: "Ada", includeInContext: false })).toBeNull();
    expect(
      buildResearchContext({ ...base, mode: "orcid", orcidId: "0000-0001" }),
    ).toBe("About the person you are assisting:\nORCID: 0000-0001");
    expect(
      buildResearchContext({
        ...base,
        papers: [{ title: "Untitled draft" }, { title: "Dated", year: "2021" }],
      }),
    ).toContain("- Untitled draft\n- Dated (2021)");
  });
});

