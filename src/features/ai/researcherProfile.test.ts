import { describe, it, expect } from "vitest";
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
