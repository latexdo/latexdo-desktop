import type { OrcidPaperRef, OrcidProfileResult } from "./types.js";

const orcidPublicApiBase = "https://pub.orcid.org/v3.0";
const orcidPattern = /(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])/;

interface OrcidValue {
  value?: string;
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

export function normalizeOrcidInput(input: string): string | null {
  const match = orcidPattern.exec(input.trim());
  return match ? match[0] : null;
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

export function parseOrcidWorks(worksJson: unknown): OrcidPaperRef[] {
  const data = (worksJson ?? {}) as {
    group?: Array<{ "work-summary"?: OrcidWorkSummary[] }>;
  };
  const groups = Array.isArray(data.group) ? data.group : [];
  const papers: OrcidPaperRef[] = [];

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

  papers.sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
  return papers.slice(0, 200);
}

export async function fetchOrcidProfile(input: string): Promise<OrcidProfileResult> {
  const id = normalizeOrcidInput(input);
  if (!id) {
    throw new Error("That doesn't look like a valid ORCID iD (0000-0000-0000-0000).");
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "LatexDo ORCID profile connector",
  };
  const [detailsRes, worksRes] = await Promise.all([
    fetch(`${orcidPublicApiBase}/${id}/personal-details`, { headers }),
    fetch(`${orcidPublicApiBase}/${id}/works`, { headers }),
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
