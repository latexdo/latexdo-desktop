// Researcher identity for the AI agent. Either an ORCID-linked scholar (whose
// public papers are fetched and fed to the agent as context) or an anonymous
// "scholar token" identity. The token is high-entropy (128 bits) but wears a
// cool cosmic codename so it's memorable and shareable.

export interface PaperRef {
  title: string;
  year?: string;
  doi?: string;
  journal?: string;
}

export type ProfileMode = "anonymous" | "orcid";
export type AcademicTitle = "" | "Dr" | "Prof" | "Prof. Dr" | "Mx";
export type ExternalProviderId = "overleaf" | "zotero" | "mendeley" | "readcube";

export interface ExternalProviderConnection {
  provider: ExternalProviderId;
  username: string;
  displayName: string;
  title: AcademicTitle;
  affiliation?: string;
  confirmed: boolean;
  connectedAt: number;
  updatedAt: number;
  projectFetchUrl?: string;
}

export interface ResearcherProfile {
  mode: ProfileMode;
  /** Anonymous scholar token (cool codename + 128-bit random suffix). */
  token: string;
  /** ORCID iD, e.g. 0000-0002-1825-0097. */
  orcidId: string;
  displayName: string;
  title: AcademicTitle;
  affiliation: string;
  externalProviders: ExternalProviderConnection[];
  papers: PaperRef[];
  papersFetchedAt: number;
  /** Feed the profile (name, affiliation, paper titles) to the agent. */
  includeInContext: boolean;
}

// Crockford base32 — omits I, L, O, U to stay unambiguous when read aloud.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CODENAME_ADJECTIVES = [
  "stellar",
  "quantum",
  "cosmic",
  "lunar",
  "nebular",
  "photonic",
  "crimson",
  "auroral",
  "tidal",
  "prismatic",
  "solar",
  "arctic",
  "obsidian",
  "electric",
  "verdant",
  "radiant",
  "spectral",
  "kinetic",
  "analytic",
  "harmonic",
  "modular",
  "affine",
  "tensorial",
  "vectorial",
  "lattice",
  "axiomatic",
  "recursive",
  "canonical",
  "syntactic",
  "semantic",
  "noetherian",
  "euclidean",
  "bayesian",
  "gaussian",
  "fourier",
  "hilbertian",
  "riemannian",
  "newtonian",
  "discrete",
  "lucid",
];
const CODENAME_NOUNS = [
  "atlas",
  "beacon",
  "harbor",
  "cipher",
  "compass",
  "engine",
  "theorem",
  "archive",
  "folio",
  "ledger",
  "quill",
  "signal",
  "aperture",
  "meridian",
  "vector",
  "matrix",
  "kernel",
  "proof",
  "axiom",
  "lemma",
  "corollary",
  "tensor",
  "prism",
  "spectrum",
  "quasar",
  "comet",
  "orbit",
  "nova",
  "nebula",
  "manifold",
  "gradient",
  "integral",
  "equation",
  "diagram",
  "preprint",
  "notebook",
  "observatory",
  "manuscript",
  "citation",
  "dataset",
  "pipeline",
  "compiler",
];

export const scholarCodenameCombinationCount =
  CODENAME_ADJECTIVES.length * CODENAME_NOUNS.length;

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(out);
  } else {
    for (let i = 0; i < length; i += 1) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function toCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += CROCKFORD[(value << (5 - bits)) & 31];
  }
  return output;
}

function randomUint32(): number {
  const bytes = randomBytes(4);
  return bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3];
}

function pick<T>(list: T[]): T {
  if (list.length === 0) throw new Error("Cannot pick from an empty list.");
  const bucketSize = Math.floor(0x100000000 / list.length);
  const limit = bucketSize * list.length;
  let value = randomUint32();
  while (value >= limit) value = randomUint32();
  return list[value % list.length];
}

/**
 * Generate a cool, high-entropy anonymous identity token, e.g.
 * "sch-cosmic-beacon-7F3KMQ2N9VXABJ8RT4WPGH6C5D". The codename pool has more
 * than 1,000 adjective/noun combinations. The suffix carries 128 bits of
 * randomness, so it's genuinely hard to guess; the codename is just flavor.
 */
export function generateScholarToken(): string {
  const suffix = toCrockford(randomBytes(16));
  return `sch-${pick(CODENAME_ADJECTIVES)}-${pick(CODENAME_NOUNS)}-${suffix}`;
}

/** Just the memorable codename part, for compact display. */
export function tokenCodename(token: string): string {
  const parts = token.split("-");
  return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : token;
}

export const defaultResearcherProfile: ResearcherProfile = {
  mode: "anonymous",
  token: "",
  orcidId: "",
  displayName: "",
  title: "",
  affiliation: "",
  externalProviders: [],
  papers: [],
  papersFetchedAt: 0,
  includeInContext: true,
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

const academicTitles = new Set<AcademicTitle>(["", "Dr", "Prof", "Prof. Dr", "Mx"]);
const externalProviderIds = new Set<ExternalProviderId>([
  "overleaf",
  "zotero",
  "mendeley",
  "readcube",
]);

function normalizeAcademicTitle(value: unknown): AcademicTitle {
  return academicTitles.has(value as AcademicTitle) ? (value as AcademicTitle) : "";
}

function normalizeExternalProviders(value: unknown): ExternalProviderConnection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const connections: ExternalProviderConnection[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Partial<ExternalProviderConnection>;
    if (!externalProviderIds.has(record.provider as ExternalProviderId)) continue;
    const provider = record.provider as ExternalProviderId;
    const username = str(record.username, "").trim().slice(0, 120);
    if (!username) continue;
    const key = `${provider}:${username.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const connectedAt =
      typeof record.connectedAt === "number" && Number.isFinite(record.connectedAt)
        ? record.connectedAt
        : Date.now();
    connections.push({
      provider,
      username,
      displayName: str(record.displayName, "").trim().slice(0, 120),
      title: normalizeAcademicTitle(record.title),
      affiliation: str(record.affiliation, "").trim().slice(0, 200) || undefined,
      confirmed: record.confirmed === true,
      connectedAt,
      updatedAt:
        typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : connectedAt,
      projectFetchUrl:
        typeof record.projectFetchUrl === "string"
          ? record.projectFetchUrl.trim().slice(0, 1000) || undefined
          : undefined,
    });
  }
  return connections.slice(0, 20);
}

export function displayNameWithTitle(
  profile: Pick<ResearcherProfile, "title" | "displayName">,
): string {
  const name = profile.displayName.trim();
  const title = profile.title.trim();
  if (!name) return "";
  return title ? `${title} ${name}` : name;
}

export function providerDisplayNameWithTitle(
  connection: Pick<ExternalProviderConnection, "title" | "displayName" | "username">,
): string {
  const displayName = connection.displayName.trim() || connection.username.trim();
  const title = connection.title.trim();
  return title ? `${title} ${displayName}` : displayName;
}

function titleCase(value: string): string {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 2
        ? part.toUpperCase()
        : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

export function suggestDisplayNameFromProviderUsername(username: string): string {
  const raw = username.trim().replace(/^@+/, "");
  const hasExplicitSeparator = /[\s._-]/.test(raw);
  const cleaned = username
    .trim()
    .replace(/^@+/, "")
    .replace(/\d+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const compact = cleaned.toLowerCase();
  const knownGivenNames = [
    "omar",
    "mohamed",
    "mohammed",
    "ahmed",
    "ali",
    "ada",
    "grace",
    "john",
    "jane",
  ];
  const givenName = hasExplicitSeparator
    ? undefined
    : knownGivenNames.find(
        (candidate) =>
          compact.startsWith(candidate) && compact.length > candidate.length,
      );
  if (givenName) {
    return titleCase(compact.slice(givenName.length));
  }
  return titleCase(cleaned);
}

function normalizePapers(value: unknown): PaperRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      title: str(p.title, "").slice(0, 400),
      year: typeof p.year === "string" ? p.year : undefined,
      doi: typeof p.doi === "string" ? p.doi : undefined,
      journal: typeof p.journal === "string" ? p.journal : undefined,
    }))
    .filter((p) => p.title.length > 0)
    .slice(0, 200);
}

export function normalizeResearcherProfile(raw: unknown): ResearcherProfile {
  const saved = (raw ?? {}) as Partial<ResearcherProfile>;
  const mode: ProfileMode = saved.mode === "orcid" ? "orcid" : "anonymous";
  // Guarantee an anonymous token always exists.
  const token = str(saved.token, "") || generateScholarToken();
  return {
    mode,
    token,
    orcidId: str(saved.orcidId, "").slice(0, 40),
    displayName: str(saved.displayName, "").slice(0, 120),
    title: normalizeAcademicTitle(saved.title),
    affiliation: str(saved.affiliation, "").slice(0, 200),
    externalProviders: normalizeExternalProviders(saved.externalProviders),
    papers: normalizePapers(saved.papers),
    papersFetchedAt:
      typeof saved.papersFetchedAt === "number" ? saved.papersFetchedAt : 0,
    includeInContext:
      typeof saved.includeInContext === "boolean" ? saved.includeInContext : true,
  };
}

/**
 * Build the research-context blurb injected into the agent's system prompt so it
 * understands who it's helping. Returns null when there's nothing useful to add.
 */
export function buildResearchContext(profile: ResearcherProfile): string | null {
  if (!profile.includeInContext) return null;

  const lines: string[] = [];
  const titledName = displayNameWithTitle(profile);
  if (titledName) lines.push(`Author: ${titledName}`);
  if (profile.affiliation) lines.push(`Affiliation: ${profile.affiliation}`);
  if (profile.mode === "orcid" && profile.orcidId) {
    lines.push(`ORCID: ${profile.orcidId}`);
  }

  if (profile.papers.length > 0) {
    lines.push(
      `The author's published work (use to infer their field, methods, and terminology):`,
    );
    for (const paper of profile.papers.slice(0, 40)) {
      const bits = [paper.title];
      if (paper.year) bits.push(`(${paper.year})`);
      if (paper.journal) bits.push(`— ${paper.journal}`);
      lines.push(`- ${bits.join(" ")}`);
    }
  }

  if (lines.length === 0) return null;
  return `About the person you are assisting:\n${lines.join("\n")}`;
}
