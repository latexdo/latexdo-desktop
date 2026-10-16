import { isLearnableEdit } from "./editNormalizer";
import {
  CONTEXT_AFTER_CHARS,
  CONTEXT_BEFORE_CHARS,
  EDIT_TTL_MS,
  MAX_DETERMINISTIC_SCAN_CHARS,
  MAX_RAW_CANDIDATES_PER_PATTERN,
  MIN_MANUAL_EXAMPLES,
  createNextEditId,
  type AnchorTokenClass,
  type DocumentEditSession,
  type DocumentSnapshot,
  type EditPattern,
  type InsertionAnchor,
  type LatexContextSignals,
  type NextEditKind,
  type NormalizedEdit,
  type PatternExample,
  type PatternRawCandidate,
  type SupportedNextEditLanguage,
} from "./nextEditTypes";

export interface PatternPredictorOptions {
  now?: () => number;
  minManualExamples?: number;
  maxRawCandidatesPerPattern?: number;
  maxScanChars?: number;
  editTtlMs?: number;
}

export class PatternPredictor {
  private readonly patternsByDocument = new Map<string, Map<string, EditPattern>>();
  private readonly now: () => number;
  private readonly minManualExamples: number;
  private readonly maxRawCandidatesPerPattern: number;
  private readonly maxScanChars: number;
  private readonly editTtlMs: number;

  constructor(options: PatternPredictorOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.minManualExamples = options.minManualExamples ?? MIN_MANUAL_EXAMPLES;
    this.maxRawCandidatesPerPattern =
      options.maxRawCandidatesPerPattern ?? MAX_RAW_CANDIDATES_PER_PATTERN;
    this.maxScanChars = options.maxScanChars ?? MAX_DETERMINISTIC_SCAN_CHARS;
    this.editTtlMs = options.editTtlMs ?? EDIT_TTL_MS;
  }

  observeEdit(
    edit: NormalizedEdit,
    language: SupportedNextEditLanguage = "latex",
  ): EditPattern | null {
    if (!isLearnableEdit(edit, { language })) return null;

    const primary = this.learnPattern(edit);
    const expanded = expandedReplacementForInsertion(edit);
    if (expanded && isLearnableEdit(expanded, { language })) {
      this.learnPattern(expanded);
    }
    return primary;
  }

  private learnPattern(edit: NormalizedEdit): EditPattern {
    const kind = editKind(edit);
    const insertionAnchor = kind === "insert" ? insertionAnchorFor(edit) : undefined;
    const signature = patternSignature(edit, kind, insertionAnchor);
    const patterns = this.patternsFor(edit.documentKey);
    let pattern = patterns.get(signature);
    if (!pattern) {
      pattern = {
        id: createNextEditId("pattern"),
        documentKey: edit.documentKey,
        kind,
        signature,
        oldText: edit.oldText,
        newText: edit.newText,
        examples: [],
        createdAt: edit.timestamp,
        lastSeenAt: edit.timestamp,
        accepts: 0,
        dismissals: 0,
        insertionAnchor,
      };
      patterns.set(signature, pattern);
    }

    pattern.examples.push(exampleFor(edit));
    pattern.lastSeenAt = edit.timestamp;
    if (pattern.insertionAnchor && insertionAnchor) {
      pattern.insertionAnchor = mergeInsertionAnchors(
        pattern.insertionAnchor,
        insertionAnchor,
      );
    }
    pattern.examples = pattern.examples
      .filter((example) => edit.timestamp - example.timestamp <= this.editTtlMs)
      .slice(-this.minManualExamples * 4);
    return pattern;
  }

  predictRawCandidates(
    snapshot: DocumentSnapshot,
    session?: DocumentEditSession,
  ): PatternRawCandidate[] {
    if (snapshot.text.length > this.maxScanChars) return [];

    const patterns = this.patternsByDocument.get(snapshot.documentKey);
    if (!patterns) return [];

    const now = this.now();
    const out: PatternRawCandidate[] = [];
    for (const pattern of patterns.values()) {
      if (now - pattern.lastSeenAt > this.editTtlMs) continue;
      if (
        manualEvidence(pattern) < minimumManualEvidence(pattern, this.minManualExamples)
      ) {
        continue;
      }
      if (session?.dismissedPatternIds.has(pattern.id)) {
        const dismissedAt = session.dismissedPatternIds.get(pattern.id) ?? 0;
        if (now - dismissedAt < 300) continue;
      }

      const generated =
        pattern.kind === "insert"
          ? this.generateInsertionCandidates(pattern, snapshot)
          : this.generateTextCandidates(pattern, snapshot);
      out.push(...generated);
      if (out.length >= this.maxRawCandidatesPerPattern) {
        return out.slice(0, this.maxRawCandidatesPerPattern);
      }
    }
    return out;
  }

  recordAccepted(candidate: { documentKey: string; patternId?: string }): void {
    const pattern = candidate.patternId
      ? this.patternById(candidate.documentKey, candidate.patternId)
      : null;
    if (pattern) pattern.accepts += 1;
  }

  recordDismissed(candidate: { documentKey: string; patternId?: string }): void {
    const pattern = candidate.patternId
      ? this.patternById(candidate.documentKey, candidate.patternId)
      : null;
    if (pattern) pattern.dismissals += 1;
  }

  patterns(documentKey: string): EditPattern[] {
    return [...(this.patternsByDocument.get(documentKey)?.values() ?? [])];
  }

  clearDocument(documentKey: string): void {
    this.patternsByDocument.delete(documentKey);
  }

  clear(): void {
    this.patternsByDocument.clear();
  }

  private generateTextCandidates(
    pattern: EditPattern,
    snapshot: DocumentSnapshot,
  ): PatternRawCandidate[] {
    const out: PatternRawCandidate[] = [];
    if (!pattern.oldText) return out;

    let from = 0;
    while (out.length < this.maxRawCandidatesPerPattern) {
      const index = snapshot.text.indexOf(pattern.oldText, from);
      if (index < 0) break;
      if (textOccurrenceMatchesPattern(pattern, snapshot.text, index)) {
        out.push(
          rawCandidateForPattern(pattern, snapshot, index, pattern.oldText.length),
        );
      }
      from = index + Math.max(1, pattern.oldText.length);
    }
    return out;
  }

  private generateInsertionCandidates(
    pattern: EditPattern,
    snapshot: DocumentSnapshot,
  ): PatternRawCandidate[] {
    const offsets = new Set<number>();
    const anchor = pattern.insertionAnchor;
    if (!anchor || !pattern.newText) return [];

    for (const example of pattern.examples) {
      const exampleAnchor = insertionAnchorForExample(example);
      collectExactAnchorOffsets(snapshot.text, exampleAnchor, offsets);
      if (offsets.size >= this.maxRawCandidatesPerPattern) break;
    }

    collectTokenBoundaryOffsets(snapshot.text, anchor, offsets);

    return [...offsets]
      .sort((a, b) => a - b)
      .filter((offset) => !alreadyHasInsertion(snapshot.text, offset, pattern.newText))
      .slice(0, this.maxRawCandidatesPerPattern)
      .map((offset) => rawCandidateForPattern(pattern, snapshot, offset, 0));
  }

  private patternsFor(documentKey: string): Map<string, EditPattern> {
    let patterns = this.patternsByDocument.get(documentKey);
    if (!patterns) {
      patterns = new Map();
      this.patternsByDocument.set(documentKey, patterns);
    }
    return patterns;
  }

  private patternById(documentKey: string, patternId: string): EditPattern | null {
    return (
      [...(this.patternsByDocument.get(documentKey)?.values() ?? [])].find(
        (pattern) => pattern.id === patternId,
      ) ?? null
    );
  }
}

export function manualEvidence(pattern: EditPattern): number {
  return pattern.examples.length;
}

export function editKind(edit: NormalizedEdit): NextEditKind {
  if (edit.oldText.length === 0) return "insert";
  if (edit.newText.length === 0) return "delete";
  return "replace";
}

export function patternSignature(
  edit: NormalizedEdit,
  kind = editKind(edit),
  insertionAnchor = kind === "insert" ? insertionAnchorFor(edit) : undefined,
): string {
  if (kind === "insert") {
    return [
      "insert",
      edit.newText,
      insertionAnchor?.leftClass ?? "boundary",
      insertionAnchor?.rightClass ?? "boundary",
      insertionAnchor?.rightToken ?? "",
    ].join("\0");
  }
  return [kind, edit.oldText, edit.newText].join("\0");
}

function minimumManualEvidence(pattern: EditPattern, defaultMinimum: number): number {
  return canSuggestFromSingleExample(pattern) ? 1 : defaultMinimum;
}

function canSuggestFromSingleExample(pattern: EditPattern): boolean {
  if (pattern.kind !== "replace") return false;
  const oldText = pattern.oldText.trim();
  if (!oldText || oldText === pattern.newText.trim()) return false;
  if (isLatexCommandToken(oldText) && isLatexCommandToken(pattern.newText.trim())) {
    return true;
  }
  if (pattern.oldText.includes("\n")) return true;
  if (oldText.length >= 8) return true;
  return isWordToken(oldText) && oldText.length >= 4;
}

export function extractLatexContext(text: string, offset: number): LatexContextSignals {
  const safeOffset = Math.min(text.length, Math.max(0, offset));
  const lineStart = text.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
  const lineEndIndex = text.indexOf("\n", safeOffset);
  const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
  const linePrefix = text.slice(lineStart, safeOffset);
  const line = text.slice(lineStart, lineEnd);
  const indent = line.match(/^\s*/)?.[0] ?? "";

  return {
    indentation: indent,
    section: nearestSection(text.slice(0, safeOffset)),
    environment: enclosingEnvironment(text.slice(0, safeOffset)),
    command: commandNear(line, safeOffset - lineStart),
    inMath: inMathMode(text.slice(0, safeOffset)),
    inComment: inComment(linePrefix),
  };
}

function expandedReplacementForInsertion(edit: NormalizedEdit): NormalizedEdit | null {
  if (edit.oldText.length > 0 || edit.newText.length === 0) return null;
  if (!isWordText(edit.newText)) return null;

  const left = tokenBefore(edit.beforeContext);
  const nextChar = edit.afterContext[0] ?? "";
  const expandsCommand =
    left.kind === "command" &&
    isLatexCommandToken(left.value) &&
    /^[A-Za-z]+$/.test(edit.newText) &&
    !isLatexCommandContinuation(nextChar);
  const expandsWord =
    left.kind === "word" && left.value.length >= 4 && !isWordChar(nextChar);

  if (!expandsCommand && !expandsWord) return null;
  if (edit.startOffsetBefore < left.value.length) return null;

  const start = edit.startOffsetBefore - left.value.length;
  return {
    ...edit,
    id: `${edit.id}:expanded-token-replace`,
    startOffsetBefore: start,
    endOffsetBefore: edit.startOffsetBefore,
    oldText: left.value,
    newText: `${left.value}${edit.newText}`,
    beforeContext: edit.beforeContext.slice(0, -left.value.length),
    afterContext: edit.afterContext,
  };
}

function exampleFor(edit: NormalizedEdit): PatternExample {
  const localText = `${edit.beforeContext}${edit.oldText}${edit.afterContext}`;
  const offset = edit.beforeContext.length;
  return {
    id: edit.id,
    startOffsetBefore: edit.startOffsetBefore,
    endOffsetBefore: edit.endOffsetBefore,
    cursorOffsetAfter: edit.cursorOffsetAfter,
    oldText: edit.oldText,
    newText: edit.newText,
    beforeContext: edit.beforeContext,
    afterContext: edit.afterContext,
    timestamp: edit.timestamp,
    latexContext: extractLatexContext(localText, offset),
  };
}

function textOccurrenceMatchesPattern(
  pattern: EditPattern,
  text: string,
  index: number,
): boolean {
  const end = index + pattern.oldText.length;
  if (isLatexCommandToken(pattern.oldText)) {
    return !isLatexCommandContinuation(text[end] ?? "");
  }
  if (isWordToken(pattern.oldText)) {
    return !isWordChar(text[index - 1] ?? "") && !isWordChar(text[end] ?? "");
  }
  return true;
}

function rawCandidateForPattern(
  pattern: EditPattern,
  snapshot: DocumentSnapshot,
  startOffset: number,
  length: number,
): PatternRawCandidate {
  const endOffset = startOffset + length;
  return {
    id: createNextEditId("candidate"),
    documentKey: snapshot.documentKey,
    kind: pattern.kind,
    startOffset,
    endOffset,
    expectedText: snapshot.text.slice(startOffset, endOffset),
    replacementText: pattern.newText,
    basedOnRevision: snapshot.revision,
    patternId: pattern.id,
    pattern,
    beforeContext: snapshot.text.slice(
      Math.max(0, startOffset - CONTEXT_BEFORE_CHARS),
      startOffset,
    ),
    afterContext: snapshot.text.slice(
      endOffset,
      Math.min(snapshot.text.length, endOffset + CONTEXT_AFTER_CHARS),
    ),
    latexContext: extractLatexContext(snapshot.text, startOffset),
  };
}

function insertionAnchorFor(edit: NormalizedEdit): InsertionAnchor {
  return {
    leftAnchor: edit.beforeContext.slice(-64),
    rightAnchor: edit.afterContext.slice(0, 64),
    ...tokensAround(edit.beforeContext, edit.afterContext),
  };
}

function insertionAnchorForExample(example: PatternExample): InsertionAnchor {
  return {
    leftAnchor: example.beforeContext.slice(-64),
    rightAnchor: example.afterContext.slice(0, 64),
    ...tokensAround(example.beforeContext, example.afterContext),
  };
}

function mergeInsertionAnchors(
  current: InsertionAnchor,
  next: InsertionAnchor,
): InsertionAnchor {
  return {
    leftAnchor: commonSuffix(current.leftAnchor, next.leftAnchor),
    rightAnchor: commonPrefix(current.rightAnchor, next.rightAnchor),
    leftToken: current.leftToken === next.leftToken ? current.leftToken : "",
    rightToken: current.rightToken === next.rightToken ? current.rightToken : "",
    leftClass: current.leftClass === next.leftClass ? current.leftClass : "boundary",
    rightClass:
      current.rightClass === next.rightClass ? current.rightClass : "boundary",
  };
}

function collectExactAnchorOffsets(
  text: string,
  anchor: InsertionAnchor,
  offsets: Set<number>,
): void {
  for (const length of [64, 32, 16]) {
    const left = anchor.leftAnchor.slice(-length);
    const right = anchor.rightAnchor.slice(0, length);
    if (!left && !right) continue;
    const needle = `${left}${right}`;
    if (!needle) continue;

    let from = 0;
    while (offsets.size < MAX_RAW_CANDIDATES_PER_PATTERN) {
      const index = text.indexOf(needle, from);
      if (index < 0) break;
      offsets.add(index + left.length);
      from = index + Math.max(1, needle.length);
    }
    if (offsets.size > 0) return;
  }
}

function collectTokenBoundaryOffsets(
  text: string,
  anchor: InsertionAnchor,
  offsets: Set<number>,
): void {
  if (anchor.rightClass === "newline") {
    for (
      let index = text.indexOf("\n");
      index >= 0;
      index = text.indexOf("\n", index + 1)
    ) {
      if (leftBoundaryMatches(text, index, anchor)) offsets.add(index);
      if (offsets.size >= MAX_RAW_CANDIDATES_PER_PATTERN) return;
    }
    if (leftBoundaryMatches(text, text.length, anchor)) offsets.add(text.length);
  }

  if (anchor.leftToken) {
    let from = 0;
    while (offsets.size < MAX_RAW_CANDIDATES_PER_PATTERN) {
      const index = text.indexOf(anchor.leftToken, from);
      if (index < 0) break;
      const offset = index + anchor.leftToken.length;
      if (rightBoundaryMatches(text, offset, anchor)) offsets.add(offset);
      from = index + Math.max(1, anchor.leftToken.length);
    }
  }

  if (anchor.rightToken) {
    let from = 0;
    while (offsets.size < MAX_RAW_CANDIDATES_PER_PATTERN) {
      const index = text.indexOf(anchor.rightToken, from);
      if (index < 0) break;
      if (leftBoundaryMatches(text, index, anchor)) offsets.add(index);
      from = index + Math.max(1, anchor.rightToken.length);
    }
  }
}

function leftBoundaryMatches(
  text: string,
  offset: number,
  anchor: InsertionAnchor,
): boolean {
  const before = text.slice(Math.max(0, offset - 80), offset);
  const token = tokenBefore(before);
  if (anchor.leftClass === "boundary") return true;
  if (anchor.leftToken && token.value !== anchor.leftToken) return false;
  return token.kind === anchor.leftClass;
}

function rightBoundaryMatches(
  text: string,
  offset: number,
  anchor: InsertionAnchor,
): boolean {
  const after = text.slice(offset, Math.min(text.length, offset + 80));
  const token = tokenAfter(after);
  if (anchor.rightClass === "boundary") return true;
  if (anchor.rightToken && token.value !== anchor.rightToken) return false;
  return token.kind === anchor.rightClass;
}

function alreadyHasInsertion(
  text: string,
  offset: number,
  insertedText: string,
): boolean {
  return (
    text.slice(offset, offset + insertedText.length) === insertedText ||
    text.slice(Math.max(0, offset - insertedText.length), offset) === insertedText
  );
}

function tokensAround(
  beforeContext: string,
  afterContext: string,
): Pick<InsertionAnchor, "leftToken" | "rightToken" | "leftClass" | "rightClass"> {
  const left = tokenBefore(beforeContext);
  const right = tokenAfter(afterContext);
  return {
    leftToken: left.value,
    rightToken: right.value,
    leftClass: left.kind,
    rightClass: right.kind,
  };
}

function tokenBefore(text: string): { value: string; kind: AnchorTokenClass } {
  if (!text) return { value: "", kind: "boundary" };
  const command = text.match(/\\[A-Za-z]+\*?$/)?.[0];
  if (command) return { value: command, kind: "command" };
  const word = text.match(/[A-Za-z0-9_-]+$/)?.[0];
  if (word) return { value: word, kind: "word" };
  const last = text[text.length - 1] ?? "";
  if (last === "\n") return { value: "\n", kind: "newline" };
  if (/\s/.test(last)) return { value: last, kind: "space" };
  return { value: last, kind: "punctuation" };
}

function tokenAfter(text: string): { value: string; kind: AnchorTokenClass } {
  if (!text) return { value: "", kind: "boundary" };
  const first = text[0] ?? "";
  if (first === "\n") return { value: "\n", kind: "newline" };
  if (/\s/.test(first)) return { value: first, kind: "space" };
  const command = text.match(/^\\[A-Za-z]+\*?/)?.[0];
  if (command) return { value: command, kind: "command" };
  const word = text.match(/^[A-Za-z0-9_-]+/)?.[0];
  if (word) return { value: word, kind: "word" };
  return { value: first, kind: "punctuation" };
}

function isLatexCommandToken(text: string): boolean {
  return /^\\[A-Za-z]{2,}\*?$/.test(text);
}

function isLatexCommandContinuation(char: string): boolean {
  return /^[A-Za-z*]$/.test(char);
}

function isWordToken(text: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(text);
}

function isWordText(text: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(text);
}

function isWordChar(char: string): boolean {
  return /^[A-Za-z0-9_-]$/.test(char);
}

function nearestSection(prefix: string): string {
  const matches = [
    ...prefix.matchAll(
      /\\(?:part|chapter|section|subsection|subsubsection)\*?\{([^}\n]{0,120})\}/g,
    ),
  ];
  return matches[matches.length - 1]?.[0] ?? "";
}

function enclosingEnvironment(prefix: string): string {
  const stack: string[] = [];
  const regex = /\\(begin|end)\{([^}\n]{1,80})\}/g;
  for (const match of prefix.matchAll(regex)) {
    const kind = match[1];
    const environment = match[2] ?? "";
    if (!environment) continue;
    if (kind === "begin") {
      stack.push(environment);
    } else {
      const index = stack.lastIndexOf(environment);
      if (index >= 0) stack.splice(index, 1);
    }
  }
  return stack[stack.length - 1] ?? "";
}

function commandNear(line: string, columnOffset: number): string {
  const prefix = line.slice(0, columnOffset);
  return prefix.match(/\\[A-Za-z]+\*?$/)?.[0] ?? "";
}

function inMathMode(prefix: string): boolean {
  let dollars = 0;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] === "$" && !isEscaped(prefix, index)) dollars += 1;
  }
  return dollars % 2 === 1;
}

function inComment(linePrefix: string): boolean {
  for (let index = 0; index < linePrefix.length; index += 1) {
    if (linePrefix[index] === "%" && !isEscaped(linePrefix, index)) return true;
  }
  return false;
}

function isEscaped(text: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function commonSuffix(a: string, b: string): string {
  const max = Math.min(a.length, b.length);
  let length = 0;
  while (length < max && a[a.length - 1 - length] === b[b.length - 1 - length]) {
    length += 1;
  }
  return a.slice(a.length - length);
}

function commonPrefix(a: string, b: string): string {
  const max = Math.min(a.length, b.length);
  let length = 0;
  while (length < max && a[length] === b[length]) {
    length += 1;
  }
  return a.slice(0, length);
}
