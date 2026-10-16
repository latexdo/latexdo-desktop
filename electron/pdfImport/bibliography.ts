/**
 * Reference list recovery.
 *
 * The reference list is the one part of a paper that is machine parseable in
 * practice, and recovering it pays off twice: the import gets a real `.bib` file,
 * and every `[7]` in the body can be turned back into a `\cite`. Entries are split
 * by their numeric marker when the style uses one and by hanging indentation
 * otherwise. Field extraction uses the usual cues plus one the PDF gives us for
 * free: in nearly every style the journal or proceedings name is the italic run.
 */

import type { TextLine } from "./layout.js";
import { lineText } from "./layout.js";
import { median } from "./model.js";

export interface Reference {
  /** Number the body cites this entry by, when the style is numeric. */
  marker: string | null;
  key: string;
  entryType: string;
  fields: Record<string, string>;
  authorSurnames: string[];
  year: string | null;
  raw: string;
  /** False when only the raw text could be recovered. */
  parsed: boolean;
}

const markerPattern = /^\[\s*(\d{1,3}[a-z]?)\s*\]\s*/;
const numberedPattern = /^(\d{1,3})\.\s+/;
const yearPattern = /\b(1[89]\d{2}|20\d{2})\b/;
const doiPattern = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9<>]+)/;
const arxivPattern = /arXiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?/i;
const urlPattern = /\bhttps?:\/\/[^\s,;)]+/;
const pagesPattern = /\bp(?:p|ages)?\.?\s*(\d+)\s*[-–—]{1,2}\s*(\d+)/i;
const volumeIssuePagesPattern =
  /\b(\d+)\s*\((\d+)\)\s*[:,]\s*(\d+)\s*[-–—]{1,2}\s*(\d+)/;
const volumePattern = /\bvol(?:ume)?\.?\s*(\d+)/i;
const numberPattern = /\bn(?:o|umber|r)\.?\s*(\d+)/i;
const editionPattern = /\b(\d+)(?:st|nd|rd|th)\s+ed(?:ition)?\b/i;

/**
 * Splits reference lines into one text block per entry.
 */
export function splitEntries(lines: TextLine[]): TextLine[][] {
  const usable = lines.filter((line) => lineText(line).trim());
  if (!usable.length) {
    return [];
  }

  const markerStarts = usable.filter((line) => {
    const text = lineText(line);
    return markerPattern.test(text) || numberedPattern.test(text);
  });

  if (markerStarts.length >= Math.max(2, usable.length * 0.18)) {
    const groups: TextLine[][] = [];
    for (const line of usable) {
      const text = lineText(line);
      if (markerPattern.test(text) || numberedPattern.test(text)) {
        groups.push([line]);
      } else if (groups.length) {
        groups[groups.length - 1].push(line);
      }
    }
    return groups.filter((group) => group.length > 0);
  }

  // No markers: rely on indentation. Entries either start at the margin with
  // indented continuations, or are indented with continuations at the margin.
  const lefts = usable.map((line) => line.left);
  const leftmost = Math.min(...lefts);
  const typicalSize = median(usable.map((line) => line.size)) || 10;
  const indented = usable.filter((line) => line.left > leftmost + typicalSize * 0.4);
  const hanging = indented.length > usable.length * 0.35;

  const groups: TextLine[][] = [];
  let previousColumn = -1;
  for (const line of usable) {
    const atMargin = line.left <= leftmost + typicalSize * 0.4;
    const startsEntry = hanging
      ? atMargin
      : !atMargin || line.pageIndex !== previousColumn;
    if (startsEntry || !groups.length) {
      groups.push([line]);
    } else {
      groups[groups.length - 1].push(line);
    }
    previousColumn = line.pageIndex;
  }
  return groups;
}

/** Longest italic run in the entry, which is normally the journal or book title. */
function italicRun(lines: TextLine[]): string {
  let best = "";
  let current = "";
  for (const line of lines) {
    for (const glyph of line.glyphs) {
      const italic = glyph.font.italic && glyph.font.mathRole === "text";
      if (glyph.space) {
        if (current) {
          current += " ";
        }
        continue;
      }
      if (italic) {
        current += glyph.text;
      } else {
        if (current.trim().length > best.trim().length) {
          best = current;
        }
        current = "";
      }
    }
    if (current) {
      current += " ";
    }
  }
  if (current.trim().length > best.trim().length) {
    best = current;
  }
  return best
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
}

function joinEntryText(lines: TextLine[]): string {
  let text = "";
  for (const line of lines) {
    const part = lineText(line);
    if (!text) {
      text = part;
      continue;
    }
    if (/[-‐]$/.test(text) && /^[a-z]/.test(part)) {
      text = `${text.replace(/[-‐]$/, "")}${part}`;
    } else {
      text = `${text} ${part}`;
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

function looksLikeInitials(token: string): boolean {
  return /^(?:[A-Z]\.?-?){1,3}$/.test(token.replace(/[.,]$/, ""));
}

function extractSurname(author: string): string | null {
  const cleaned = author.replace(/[^A-Za-zÀ-ɏ'\- .]/g, " ").trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.includes(",")) {
    const head = cleaned.split(",")[0].trim();
    const parts = head.split(/\s+/);
    return parts[parts.length - 1] || null;
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const named = tokens.filter((token) => !looksLikeInitials(token) && token.length > 1);
  return named.length ? named[named.length - 1] : (tokens[tokens.length - 1] ?? null);
}

/** Normalises an author list into the `A and B and C` form BibTeX expects. */
function splitAuthors(raw: string): string[] {
  let text = raw
    .trim()
    .replace(/\s*&\s*/g, " and ")
    .replace(/\bet\s+al\.?/i, "others");
  text = text.replace(/,\s*and\s+/gi, " and ").replace(/\s+and\s+/gi, " and ");

  // Surname-first styles repeat the pattern `Surname, I. I.`, so the separating
  // comma is the one that precedes another capitalised surname.
  if (/^[A-Z][A-Za-z'-]+,\s*[A-Z]/.test(text)) {
    const parts = text
      .split(/,\s*(?=[A-Z][A-Za-z'-]+\s*,)/)
      .flatMap((part) => part.split(/\s+and\s+/i));
    return parts.map((part) => part.trim().replace(/[.,;]+$/, "")).filter(Boolean);
  }

  return text
    .split(/(?:,\s*|\s+and\s+)/i)
    .map((part) => part.trim().replace(/[.,;]+$/, ""))
    .filter((part) => part.length > 1);
}

function guessEntryType(text: string, journal: string): string {
  const lower = text.toLowerCase();
  if (/\bphd\b|\bdoctoral\b/.test(lower) && /thesis|dissertation/.test(lower)) {
    return "phdthesis";
  }
  if (/master'?s?\s+thesis|\bmsc\b/.test(lower)) {
    return "mastersthesis";
  }
  if (/technical report|tech\.? rep\.?|\btr-\d/.test(lower)) {
    return "techreport";
  }
  if (
    /\bin\s+(?:proc|proceedings)|conference on|workshop on|symposium|\bin:\s/.test(
      lower,
    )
  ) {
    return "inproceedings";
  }
  if (/arxiv|preprint/.test(lower) && !/\bin\s+proc/.test(lower)) {
    return "misc";
  }
  if (/\bp(?:p|ages)?\.?\s*\d+\s*[-–—]/.test(lower) && journal) {
    return "article";
  }
  if (journal || volumeIssuePagesPattern.test(text) || volumePattern.test(text)) {
    return "article";
  }
  if (/\bed(?:s|itors?)?\.\b|\bpress\b|\bpublish/.test(lower)) {
    return "book";
  }
  return "misc";
}

const bibEscapes: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  $: "\\$",
  "%": "\\%",
  "&": "\\&",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

function escapeBibValue(value: string): string {
  return value.replace(/[\\{}#$%&_~^]/g, (character) => bibEscapes[character]).trim();
}

/** Protects capitalised words so BibTeX styles do not lower-case them. */
function protectTitleCase(value: string): string {
  return value.replace(/\b([A-Z]{2,}|[A-Z]\w*[A-Z]\w*)\b/g, "{$1}");
}

export function parseReference(lines: TextLine[], usedKeys: Set<string>): Reference {
  const rawWithMarker = joinEntryText(lines);
  const markerMatch =
    markerPattern.exec(rawWithMarker) ?? numberedPattern.exec(rawWithMarker);
  const marker = markerMatch ? markerMatch[1] : null;
  const text = markerMatch
    ? rawWithMarker.slice(markerMatch[0].length).trim()
    : rawWithMarker;

  const fields: Record<string, string> = {};
  const yearMatch = yearPattern.exec(text);
  const year = yearMatch ? yearMatch[1] : null;

  const doi = doiPattern.exec(text);
  if (doi) {
    fields.doi = doi[1].replace(/[.,;]$/, "");
  }
  const arxiv = arxivPattern.exec(text);
  if (arxiv) {
    fields.eprint = arxiv[1];
    fields.archivePrefix = "arXiv";
  }
  const url = urlPattern.exec(text);
  if (url && !doi) {
    fields.url = url[0].replace(/[.,;]$/, "");
  }

  const volumeIssuePages = volumeIssuePagesPattern.exec(text);
  if (volumeIssuePages) {
    fields.volume = volumeIssuePages[1];
    fields.number = volumeIssuePages[2];
    fields.pages = `${volumeIssuePages[3]}--${volumeIssuePages[4]}`;
  } else {
    const pages = pagesPattern.exec(text);
    if (pages) {
      fields.pages = `${pages[1]}--${pages[2]}`;
    }
    const volume = volumePattern.exec(text);
    if (volume) {
      fields.volume = volume[1];
    }
    const number = numberPattern.exec(text);
    if (number) {
      fields.number = number[1];
    }
  }
  const edition = editionPattern.exec(text);
  if (edition) {
    fields.edition = edition[1];
  }

  const journal = italicRun(lines);

  // Authors run up to the first sentence break that is not an initial, or to the
  // year when the style puts it directly after the author list.
  let authorText = "";
  let remainder: string;
  const yearFirst = year
    ? new RegExp(`^(.{3,160}?)\\s*[(\\[]?${year}[)\\]]?[.,]?\\s+`).exec(text)
    : null;
  if (yearFirst) {
    authorText = yearFirst[1].replace(/[.,;]+$/, "");
    remainder = text.slice(yearFirst[0].length);
  } else {
    const sentences = text.split(/(?<=[^A-Z])\.\s+/);
    if (sentences.length > 1) {
      authorText = sentences[0];
      remainder = text.slice(sentences[0].length + 1).trim();
    } else {
      remainder = text;
    }
  }

  const authors = authorText ? splitAuthors(authorText) : [];
  const surnames = authors
    .map(extractSurname)
    .filter((name): name is string => Boolean(name));

  // The title is what follows the authors, up to the italic venue or the next stop.
  let title = "";
  if (remainder) {
    const untilJournal =
      journal && remainder.includes(journal)
        ? remainder.slice(0, remainder.indexOf(journal))
        : remainder;
    const candidate =
      untilJournal.split(/(?<=[^A-Z])\.\s+|\bIn\b\s|\bin:\s/)[0] ?? untilJournal;
    title = candidate.replace(/[.,;]+\s*$/, "").trim();
    if (title.length > 300) {
      title = title.slice(0, 300);
    }
  }

  const entryType = guessEntryType(text, journal);

  if (authors.length) {
    fields.author = escapeBibValue(authors.join(" and "));
  }
  if (title) {
    fields.title = protectTitleCase(escapeBibValue(title));
  }
  if (year) {
    fields.year = year;
  }
  if (journal) {
    if (entryType === "inproceedings") {
      fields.booktitle = escapeBibValue(journal);
    } else if (entryType === "book" || entryType === "misc") {
      fields.publisher = escapeBibValue(journal);
    } else {
      fields.journal = escapeBibValue(journal);
    }
  } else if (entryType === "inproceedings") {
    const inMatch = /\b(?:In|in:)\s+(.{4,140}?)(?:[.,]\s|$)/.exec(text);
    if (inMatch) {
      fields.booktitle = escapeBibValue(inMatch[1]);
    }
  }

  const parsed = Boolean(fields.author && (fields.title || journal));
  if (!parsed) {
    fields.note = escapeBibValue(text);
  }

  const base =
    (surnames[0] ?? "ref").toLowerCase().replace(/[^a-z]/g, "") +
    (year ?? "") +
    (marker && !surnames.length ? `-${marker}` : "");
  let key = base || `ref${marker ?? usedKeys.size + 1}`;
  if (usedKeys.has(key)) {
    for (const suffix of "abcdefghijklmnopqrstuvwxyz") {
      if (!usedKeys.has(`${key}${suffix}`)) {
        key = `${key}${suffix}`;
        break;
      }
    }
  }
  usedKeys.add(key);

  return {
    marker,
    key,
    entryType,
    fields,
    authorSurnames: surnames,
    year,
    raw: text,
    parsed,
  };
}

export function parseBibliography(lines: TextLine[]): Reference[] {
  const usedKeys = new Set<string>();
  return splitEntries(lines)
    .map((group) => parseReference(group, usedKeys))
    .filter((reference) => reference.raw.length > 8);
}

export function renderBibFile(references: Reference[]): string {
  const fieldOrder = [
    "author",
    "title",
    "journal",
    "booktitle",
    "publisher",
    "school",
    "institution",
    "edition",
    "volume",
    "number",
    "pages",
    "year",
    "doi",
    "url",
    "archivePrefix",
    "eprint",
    "note",
  ];

  const blocks = references.map((reference) => {
    const lines = [`@${reference.entryType}{${reference.key},`];
    const entries: string[] = [];
    for (const field of fieldOrder) {
      const value = reference.fields[field];
      if (value) {
        entries.push(`  ${field} = {${value}}`);
      }
    }
    lines.push(entries.join(",\n"));
    lines.push("}");
    const header = reference.parsed
      ? ""
      : `% Only the raw text of this entry could be recovered; check the fields.\n`;
    return `${header}${lines.join("\n")}`;
  });

  return `% Generated by LatexDo from a PDF import.\n% Verify every entry before submission.\n\n${blocks.join("\n\n")}\n`;
}
