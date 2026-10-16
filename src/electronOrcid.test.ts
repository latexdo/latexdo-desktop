import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOrcidProfile } from "../electron/orcid";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("electron ORCID profile fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses an ORCID profile through the main process helper", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/personal-details")) {
        return jsonResponse({
          name: {
            "given-names": { value: "Ada" },
            "family-name": { value: "Lovelace" },
          },
        });
      }
      if (href.endsWith("/works")) {
        return jsonResponse({
          group: [
            {
              "work-summary": [
                {
                  title: { title: { value: "Notes on the Analytical Engine" } },
                  "publication-date": { year: { value: "1843" } },
                  "journal-title": { value: "Scientific Memoirs" },
                  "external-ids": {
                    "external-id": [
                      {
                        "external-id-type": "doi",
                        "external-id-value": "10.1000/test",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOrcidProfile("https://orcid.org/0000-0002-1825-0097"),
    ).resolves.toEqual({
      name: "Ada Lovelace",
      papers: [
        {
          title: "Notes on the Analytical Engine",
          year: "1843",
          journal: "Scientific Memoirs",
          doi: "10.1000/test",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a missing public ORCID record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));

    await expect(fetchOrcidProfile("0000-0002-1825-0097")).rejects.toThrow(
      "No public ORCID record found for that iD.",
    );
  });
});
