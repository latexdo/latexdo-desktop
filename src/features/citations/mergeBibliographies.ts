export interface BibliographyFile {
  path: string;
  content: string;
}

export interface MergedBibliography {
  content: string;
  /** Entries written to the merged file. */
  entryCount: number;
  /** Keys that appeared more than once with identical text; kept once. */
  duplicates: string[];
  /** Keys defined differently in several files; the first is kept. */
  conflicts: Array<{ key: string; keptFrom: string; droppedFrom: string[] }>;
}

interface BibBlock {
  start: number;
  end: number;
  type: string;
  key: string | null;
  text: string;
}

/** Splits a .bib file into its @-blocks, matching braces or parentheses. */
export function bibBlocks(content: string): BibBlock[] {
  const blocks: BibBlock[] = [];
  let index = 0;
  while ((index = content.indexOf("@", index)) !== -1) {
    const header = /^@\s*([a-zA-Z]+)\s*([({])/.exec(content.slice(index));
    if (!header) {
      index += 1;
      continue;
    }
    const open = header[2];
    const close = open === "{" ? "}" : ")";
    let depth = 0;
    let end = -1;
    for (
      let cursor = index + header[0].length - 1;
      cursor < content.length;
      cursor += 1
    ) {
      const char = content[cursor];
      if (char === "\\") {
        cursor += 1;
      } else if (char === open || (open === "(" && char === "{")) {
        depth += 1;
      } else if (char === close || (open === "(" && char === "}")) {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          break;
        }
      }
    }
    if (end === -1) break; // Unterminated entry: leave the rest alone.
    const text = content.slice(index, end).trim();
    const type = header[1].toLowerCase();
    const key =
      type === "string" || type === "preamble" || type === "comment"
        ? null
        : (/^@\s*[a-zA-Z]+\s*[({]\s*([^,\s]+)\s*,/.exec(text)?.[1] ?? null);
    blocks.push({ type, key, text, start: index, end });
    index = end;
  }
  return blocks;
}

const normalizeBlock = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * One bibliography from several. @string and @preamble blocks come first so
 * entries can use them; an entry defined in two files is written once.
 */
export function mergeBibliographies(
  files: readonly BibliographyFile[],
  mergedAt = new Date(),
): MergedBibliography {
  const macros: string[] = [];
  const macroSeen = new Set<string>();
  const entries = new Map<string, { text: string; path: string }>();
  const duplicates = new Set<string>();
  const conflicts = new Map<string, { keptFrom: string; droppedFrom: string[] }>();

  for (const file of files) {
    for (const block of bibBlocks(file.content)) {
      if (block.type === "comment") continue;
      if (!block.key) {
        const normalized = normalizeBlock(block.text);
        if (!macroSeen.has(normalized)) {
          macroSeen.add(normalized);
          macros.push(block.text);
        }
        continue;
      }
      const lower = block.key.toLowerCase();
      const existing = entries.get(lower);
      if (!existing) {
        entries.set(lower, { text: block.text, path: file.path });
      } else if (normalizeBlock(existing.text) === normalizeBlock(block.text)) {
        duplicates.add(block.key);
      } else {
        const conflict = conflicts.get(block.key) ?? {
          keptFrom: existing.path,
          droppedFrom: [],
        };
        conflict.droppedFrom.push(file.path);
        conflicts.set(block.key, conflict);
      }
    }
  }

  const header = [
    `% Merged by LatexDo on ${mergedAt.toISOString().slice(0, 10)} from:`,
    ...files.map((file) => `%   ${file.path}`),
  ];
  for (const [key, conflict] of conflicts) {
    header.push(
      `% ${key}: kept the entry from ${conflict.keptFrom}; a different one in ${conflict.droppedFrom.join(", ")} was left out.`,
    );
  }
  const body = [...macros, ...[...entries.values()].map((entry) => entry.text)];
  return {
    content: `${header.join("\n")}\n\n${body.join("\n\n")}\n`,
    entryCount: entries.size,
    duplicates: [...duplicates],
    conflicts: [...conflicts].map(([key, conflict]) => ({ key, ...conflict })),
  };
}

const bibName = (value: string) =>
  value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.bib$/i, "");

/**
 * Points \bibliography and \addbibresource at the merged file instead of the
 * files it replaced. Null when the source names none of them.
 */
export function retargetBibliographyCommands(
  tex: string,
  replacedPaths: readonly string[],
  mergedPath: string,
): string | null {
  const replaced = new Set(replacedPaths.map(bibName));
  const merged = bibName(mergedPath);
  let changed = false;

  let next = tex.replace(/\\bibliography\{([^}]*)\}/g, (command, list: string) => {
    const names = list.split(",").map(bibName).filter(Boolean);
    if (!names.some((name) => replaced.has(name))) return command;
    changed = true;
    const kept = names.filter((name) => !replaced.has(name));
    return `\\bibliography{${[merged, ...kept.filter((name) => name !== merged)].join(",")}}`;
  });

  let pointed = false;
  next = next.replace(
    /^([ \t]*)\\addbibresource(\[[^\]]*\])?\{([^}]*)\}[ \t]*\r?\n?/gm,
    (command, indent: string, options: string | undefined, file: string) => {
      if (!replaced.has(bibName(file)) && bibName(file) !== merged) return command;
      changed = true;
      if (pointed) return "";
      pointed = true;
      const newline = command.endsWith("\n") ? "\n" : "";
      return `${indent}\\addbibresource${options ?? ""}{${merged}.bib}${newline}`;
    },
  );
  return changed ? next : null;
}
