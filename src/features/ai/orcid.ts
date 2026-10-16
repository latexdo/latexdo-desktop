// ORCID public API integration. Fetches a researcher's public name and works by
// ORCID iD — no OAuth required for public data. Parsing is split into pure
// functions so they can be unit-tested against sample payloads.

import type { PaperRef } from "./researcherProfile";

const ORCID_PUB_BASE = "https://pub.orcid.org/v3.0";
const ORCID_RE = /(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])/;

/** Extract a bare ORCID iD from a raw string or an orcid.org URL. */
export function normalizeOrcidInput(input: string): string | null {
  const match = ORCID_RE.exec(input.trim());
  return match ? match[0] : null;
}

export function isValidOrcid(input: string): boolean {
  return normalizeOrcidInput(input) !== null;
}

interface OrcidValue {
  value?: string;
}

export function parseOrcidName(personalDetails: unknown): string {
  const details = (personalDetails ?? {}) as {
    name?: {
      "given-names"?: OrcidValue;
      "family-name"?: OrcidValue;
      "credit-name"?: OrcidValue;
    };
  };
  const name = details.name;
  if (!name) return "";
  const credit = name["credit-name"]?.value;
  if (credit) return credit;
  const given = name["given-names"]?.value ?? "";
  const family = name["family-name"]?.value ?? "";
  return `${given} ${family}`.trim();
}

interface OrcidWorkSummary {
  title?: { title?: OrcidValue };
  "journal-title"?: OrcidValue;
  "publication-date"?: { year?: OrcidValue };
  "external-ids"?: {
    "external-id"?: Array<{
      "external-id-type"?: string;
      "external-id-value"?: string;
    }>;
  };
}

export function parseOrcidWorks(worksJson: unknown): PaperRef[] {
  const data = (worksJson ?? {}) as {
    group?: Array<{ "work-summary"?: OrcidWorkSummary[] }>;
  };
  const groups = Array.isArray(data.group) ? data.group : [];
  const papers: PaperRef[] = [];

  for (const group of groups) {
    const summary = group["work-summary"]?.[0];
    if (!summary) continue;
    const title = summary.title?.title?.value?.trim();
    if (!title) continue;

    const year = summary["publication-date"]?.year?.value;
    const journal = summary["journal-title"]?.value?.trim() || undefined;
    const doi = summary["external-ids"]?.["external-id"]?.find(
      (id) => (id["external-id-type"] ?? "").toLowerCase() === "doi",
    )?.["external-id-value"];

    papers.push({
      title,
      year: year || undefined,
      journal,
      doi: doi || undefined,
    });
  }

  // Newest first when years are present.
  papers.sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
  return papers.slice(0, 200);
}

export interface OrcidFetchResult {
  name: string;
  papers: PaperRef[];
}

/** Fetch a researcher's public name + works. Throws on network/HTTP failure. */
export async function fetchOrcidProfileDirect(
  orcidInput: string,
): Promise<OrcidFetchResult> {
  const id = normalizeOrcidInput(orcidInput);
  if (!id) {
    throw new Error("That doesn't look like a valid ORCID iD (0000-0000-0000-0000).");
  }
  const headers = { Accept: "application/json" };

  const [detailsRes, worksRes] = await Promise.all([
    fetch(`${ORCID_PUB_BASE}/${id}/personal-details`, { headers }),
    fetch(`${ORCID_PUB_BASE}/${id}/works`, { headers }),
  ]);

  if (!worksRes.ok) {
    throw new Error(
      worksRes.status === 404
        ? "No public ORCID record found for that iD."
        : `ORCID request failed (HTTP ${worksRes.status}).`,
    );
  }

  const name = detailsRes.ok ? parseOrcidName(await detailsRes.json()) : "";
  const papers = parseOrcidWorks(await worksRes.json());
  return { name, papers };
}

function desktopOrcidProfileFetcher():
  | ((orcidInput: string) => Promise<OrcidFetchResult>)
  | null {
  if (typeof window === "undefined") return null;
  const api = (
    window as {
      latexdo?: {
        fetchOrcidProfile?: (orcidInput: string) => Promise<OrcidFetchResult>;
      };
    }
  ).latexdo;
  return api?.fetchOrcidProfile ?? null;
}

/** Fetch a researcher's public name + works. Throws on network/HTTP failure. */
export async function fetchOrcidProfile(orcidInput: string): Promise<OrcidFetchResult> {
  const fetchFromDesktop = desktopOrcidProfileFetcher();
  if (fetchFromDesktop) {
    return fetchFromDesktop(orcidInput);
  }
  return fetchOrcidProfileDirect(orcidInput);
}
