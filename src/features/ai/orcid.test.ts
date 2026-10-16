import { describe, it, expect, vi } from "vitest";
import {
  fetchOrcidProfile,
  normalizeOrcidInput,
  isValidOrcid,
  parseOrcidName,
  parseOrcidWorks,
} from "./orcid";

describe("normalizeOrcidInput", () => {
  it("accepts a bare iD", () => {
    expect(normalizeOrcidInput("0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
  });
  it("extracts the iD from an orcid.org URL", () => {
    expect(normalizeOrcidInput("https://orcid.org/0000-0002-1825-0097")).toBe(
      "0000-0002-1825-0097",
    );
  });
  it("accepts the X checksum digit", () => {
    expect(isValidOrcid("0000-0002-1694-233X")).toBe(true);
  });
  it("rejects nonsense", () => {
    expect(normalizeOrcidInput("not-an-orcid")).toBeNull();
  });
});

describe("parseOrcidName", () => {
  it("prefers credit-name, else given + family", () => {
    expect(
      parseOrcidName({
        name: {
          "given-names": { value: "Ada" },
          "family-name": { value: "Lovelace" },
        },
      }),
    ).toBe("Ada Lovelace");
    expect(
      parseOrcidName({ name: { "credit-name": { value: "A. A. Lovelace" } } }),
    ).toBe("A. A. Lovelace");
  });
});

describe("parseOrcidWorks", () => {
  it("extracts title, year, journal and DOI, newest first", () => {
    const works = {
      group: [
        {
          "work-summary": [
            {
              title: { title: { value: "Older Paper" } },
              "publication-date": { year: { value: "2018" } },
              "journal-title": { value: "J. Test" },
              "external-ids": {
                "external-id": [
                  {
                    "external-id-type": "doi",
                    "external-id-value": "10.1/older",
                  },
                ],
              },
            },
          ],
        },
        {
          "work-summary": [
            {
              title: { title: { value: "Newer Paper" } },
              "publication-date": { year: { value: "2023" } },
            },
          ],
        },
      ],
    };
    const papers = parseOrcidWorks(works);
    expect(papers).toHaveLength(2);
    expect(papers[0].title).toBe("Newer Paper"); // 2023 sorts first
    expect(papers[1]).toMatchObject({
      title: "Older Paper",
      year: "2018",
      journal: "J. Test",
      doi: "10.1/older",
    });
  });

  it("skips entries without a title and tolerates junk", () => {
    expect(parseOrcidWorks({})).toEqual([]);
    expect(parseOrcidWorks({ group: [{ "work-summary": [{}] }] })).toEqual([]);
  });
});

describe("fetchOrcidProfile", () => {
  it("uses the desktop ORCID bridge when available", async () => {
    const originalLatexDo = (window as { latexdo?: unknown }).latexdo;
    const fetchFromDesktop = vi.fn().mockResolvedValue({
      name: "Ada Lovelace",
      papers: [{ title: "Notes", year: "1843" }],
    });
    Object.defineProperty(window, "latexdo", {
      configurable: true,
      value: { fetchOrcidProfile: fetchFromDesktop },
    });

    try {
      await expect(fetchOrcidProfile("0000-0002-1825-0097")).resolves.toEqual({
        name: "Ada Lovelace",
        papers: [{ title: "Notes", year: "1843" }],
      });
      expect(fetchFromDesktop).toHaveBeenCalledWith("0000-0002-1825-0097");
    } finally {
      Object.defineProperty(window, "latexdo", {
        configurable: true,
        value: originalLatexDo,
      });
    }
  });
});
