import { describe, expect, it } from "vitest";
import {
  attachMentionedFiles,
  detectTrigger,
  expandSlashCommand,
  extractFileMentions,
  filterCommandSuggestions,
  filterFileSuggestions,
  slashCommands,
} from "./aiMentions";

const files = [
  "main.tex",
  "sections/intro.tex",
  "sections/methods.tex",
  "refs/bibliography.bib",
  "figures/pipeline.pdf",
];

describe("detectTrigger", () => {
  it("detects an @ file trigger at the caret", () => {
    const trigger = detectTrigger("please read @sec", 16);
    expect(trigger).toEqual({ kind: "file", query: "sec", start: 12, end: 16 });
  });

  it("detects a \\ command trigger", () => {
    const trigger = detectTrigger("\\fi", 3);
    expect(trigger).toEqual({ kind: "command", query: "fi", start: 0, end: 3 });
  });

  it("requires the trigger to start a word", () => {
    expect(detectTrigger("mail me at a@b", 14)).toBeNull();
    expect(detectTrigger("use a\\cite", 10)).toBeNull();
  });

  it("closes once the token ends", () => {
    expect(detectTrigger("@main.tex done", 14)).toBeNull();
    expect(detectTrigger("\\cite{key}", 10)).toBeNull();
  });

  it("allows the trigger after opening brackets", () => {
    expect(detectTrigger("(see @intro", 11)?.query).toBe("intro");
  });
});

describe("filterFileSuggestions", () => {
  it("ranks basename matches above path matches", () => {
    const result = filterFileSuggestions(files, "intro");
    expect(result[0]).toBe("sections/intro.tex");
  });

  it("matches anywhere in the path", () => {
    expect(filterFileSuggestions(files, "sections")).toEqual([
      "sections/intro.tex",
      "sections/methods.tex",
    ]);
  });

  it("returns everything (capped) for an empty query", () => {
    expect(filterFileSuggestions(files, "")).toHaveLength(files.length);
  });
});

describe("filterCommandSuggestions", () => {
  it("filters by prefix", () => {
    expect(filterCommandSuggestions("f").map((c) => c.name)).toEqual(["fix"]);
  });

  it("returns all commands for an empty query", () => {
    expect(filterCommandSuggestions("")).toHaveLength(slashCommands.length);
  });
});

describe("extractFileMentions", () => {
  it("resolves exact paths, suffixes, and basename prefixes", () => {
    expect(extractFileMentions("read @sections/intro.tex", files)).toEqual([
      "sections/intro.tex",
    ]);
    expect(extractFileMentions("read @intro.tex", files)).toEqual([
      "sections/intro.tex",
    ]);
    expect(extractFileMentions("read @bibliography", files)).toEqual([
      "refs/bibliography.bib",
    ]);
  });

  it("ignores unknown tokens and email-like text", () => {
    expect(extractFileMentions("ping @nosuchfile and a@b.com", files)).toEqual([]);
  });

  it("dedupes and strips trailing punctuation", () => {
    expect(extractFileMentions("compare @main.tex, @main.tex.", files)).toEqual([
      "main.tex",
    ]);
  });
});

describe("expandSlashCommand", () => {
  it("expands a known leading command", () => {
    const fix = slashCommands.find((c) => c.name === "fix")!;
    expect(expandSlashCommand("\\fix")).toBe(fix.prompt);
  });

  it("keeps trailing text as extra instructions", () => {
    const out = expandSlashCommand("\\rewrite keep it formal");
    expect(out).toContain("Rewrite the currently selected text");
    expect(out).toContain("Additional instructions: keep it formal");
  });

  it("leaves plain LaTeX and unknown commands untouched", () => {
    expect(expandSlashCommand("\\cite{key} is broken")).toBe("\\cite{key} is broken");
    expect(expandSlashCommand("\\usepackage help")).toBe("\\usepackage help");
    expect(expandSlashCommand("just text")).toBe("just text");
  });
});

describe("attachMentionedFiles", () => {
  it("appends file contents as attachment blocks", async () => {
    const out = await attachMentionedFiles(
      "summarize",
      ["main.tex"],
      async () => "\\documentclass{article}",
    );
    expect(out).toContain("summarize");
    expect(out).toContain("[Attached file: main.tex]");
    expect(out).toContain("\\documentclass{article}");
  });

  it("reports unreadable files instead of failing", async () => {
    const out = await attachMentionedFiles("go", ["missing.tex"], async () => {
      throw new Error("ENOENT");
    });
    expect(out).toContain("[Attached file: missing.tex] (could not read: ENOENT)");
  });

  it("returns the text unchanged with no mentions", async () => {
    expect(await attachMentionedFiles("hi", [], async () => "")).toBe("hi");
  });
});
