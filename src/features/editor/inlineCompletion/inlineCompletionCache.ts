// Remembers recent suggestions so typing the suggested letters, or deleting a
// few and typing them again, keeps the ghost text without asking the model
// again, as Copilot does.

interface CacheEntry {
  prefix: string;
  lineSuffix: string;
  completion: string;
}

/** Letters that may be deleted while a suggestion still applies. */
const maxBackspaceChars = 40;

export class InlineCompletionCache {
  private entries: CacheEntry[] = [];

  constructor(private readonly maxEntries = 40) {}

  /** The rest of a cached suggestion that still fits the text, or null. */
  get(prefix: string, lineSuffix: string): string | null {
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index];
      if (entry.lineSuffix !== lineSuffix) continue;
      if (prefix.startsWith(entry.prefix)) {
        const typed = prefix.slice(entry.prefix.length);
        if (
          typed.length < entry.completion.length &&
          entry.completion.startsWith(typed)
        ) {
          return entry.completion.slice(typed.length);
        }
      } else if (entry.prefix.startsWith(prefix)) {
        const deleted = entry.prefix.slice(prefix.length);
        if (deleted.length <= maxBackspaceChars && !deleted.includes("\n")) {
          return deleted + entry.completion;
        }
      }
    }
    return null;
  }

  set(prefix: string, lineSuffix: string, completion: string): void {
    this.entries = this.entries.filter(
      (entry) => entry.prefix !== prefix || entry.lineSuffix !== lineSuffix,
    );
    this.entries.push({ prefix, lineSuffix, completion });
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }
}
