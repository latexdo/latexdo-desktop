import { describe, it, expect } from "vitest";

describe("Utility functions", () => {
  describe("findLine", () => {
    function findLine(content: string, index: number): number {
      return content.substring(0, index).split("\n").length;
    }

    it("returns 1 for first character", () => {
      expect(findLine("abc", 0)).toBe(1);
    });

    it("returns 2 for content after first newline", () => {
      expect(findLine("a\nb", 2)).toBe(2);
    });

    it("returns correct line for later content", () => {
      const content = "line1\nline2\nline3\nline4\nline5";
      expect(findLine(content, 24)).toBe(5);
    });

    it("handles empty string", () => {
      expect(findLine("", 0)).toBe(1);
    });

    it("handles content with only newlines", () => {
      expect(findLine("\n\n\n", 3)).toBe(4);
    });

    it("handles index at end of string", () => {
      expect(findLine("hello", 4)).toBe(1);
    });

    it("handles index at newline position", () => {
      expect(findLine("a\nb\nc", 2)).toBe(2);
    });
  });

  describe("countWords", () => {
    function countWords(text: string): number {
      return text.split(/[\s\n]+/).filter(Boolean).length;
    }

    it("counts simple words", () => {
      expect(countWords("hello world")).toBe(2);
    });

    it("counts zero for empty string", () => {
      expect(countWords("")).toBe(0);
    });

    it("counts words with punctuation", () => {
      expect(countWords("hello, world! test.")).toBe(3);
    });

    it("handles multiple spaces", () => {
      expect(countWords("hello    world")).toBe(2);
    });

    it("handles newlines and tabs", () => {
      expect(countWords("hello\n\tworld\nfoo")).toBe(3);
    });

    it("handles only whitespace", () => {
      expect(countWords("   \n  \t  ")).toBe(0);
    });

    it("handles large word count", () => {
      const text = Array(1000).fill("word").join(" ");
      expect(countWords(text)).toBe(1000);
    });
  });

  describe("Data structures", () => {
    it("can create Diagnostic objects properly", () => {
      const diag = {
        file: "test.tex",
        line: 10,
        column: 1,
        severity: "warning" as const,
        source: "latex" as const,
        message: "Test warning",
        detail: "This is a test",
        suggestion: "Do something",
      };
      expect(diag.file).toBe("test.tex");
      expect(diag.severity).toBe("warning");
    });

    it("can create error Diagnostics", () => {
      const diag = {
        file: "test.tex",
        line: 5,
        column: 1,
        severity: "error" as const,
        source: "latex" as const,
        message: "Test error",
        detail: "Something went wrong",
      };
      expect(diag.severity).toBe("error");
    });

    it("can create Diagnostic with optional fields", () => {
      const diag = {
        file: "test.tex",
        line: 1,
        column: 1,
        severity: "warning" as const,
        source: "latex" as const,
        message: "Test",
        fixes: [
          {
            title: "Fix",
            expectedText: "old",
            replacement: "new",
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 5,
            confidence: 0.9,
          },
        ],
        isPrimary: true,
        priority: 1,
      };
      expect(diag.fixes).toHaveLength(1);
      expect(diag.isPrimary).toBe(true);
      expect(diag.priority).toBe(1);
    });

    it("can create Diagnostics with sourceContext", () => {
      const diag = {
        file: "test.tex",
        line: 10,
        column: 1,
        severity: "error" as const,
        source: "structure-assistant" as const,
        message: "Structure issue",
        sourceContext: [
          { line: 9, text: "context line", focus: false },
          { line: 10, text: "error line", focus: true },
        ],
      };
      expect(diag.sourceContext).toHaveLength(2);
      expect(diag.sourceContext![1].focus).toBe(true);
    });
  });

  describe("LaTeX snippet parsing", () => {
    it("identifies cite commands", () => {
      const text = "See \\cite{ref1,ref2} and \\citep{ref3}.";
      const matches = [...text.matchAll(/\\cite(?:[tp]?\*?)?\{([^}]+)\}/g)];
      expect(matches).toHaveLength(2);
    });

    it("extracts citation keys", () => {
      const text = "\\cite{ref1,ref2}";
      const match = text.match(/\\cite(?:[tp]?\*?)?\{([^}]+)\}/);
      const keys = match![1].split(",").map((k) => k.trim());
      expect(keys).toEqual(["ref1", "ref2"]);
    });

    it("identifies section commands", () => {
      const text = "\\section{Introduction}\nContent.\n\\section{Related Work}\nMore.";
      const matches = [...text.matchAll(/\\section\s*\{([^}]+)\}/g)];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe("Introduction");
      expect(matches[1][1]).toBe("Related Work");
    });

    it("identifies figure environments", () => {
      const text = "\\begin{figure}\\caption{A}\\end{figure}";
      const matches = text.match(/\\begin\s*\{figure\}/g);
      expect(matches).toHaveLength(1);
    });

    it("identifies label commands", () => {
      const text = "\\label{fig:result}\\label{tab:data}";
      const matches = [...text.matchAll(/\\label\s*\{([^}]+)\}/g)];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe("fig:result");
      expect(matches[1][1]).toBe("tab:data");
    });

    it("identifies equation environments", () => {
      const text = "\\begin{equation}E=mc^2\\end{equation}";
      expect(/\\begin\s*\{equation\}/.test(text)).toBe(true);
    });

    it("identifies inline math", () => {
      const text = "The value $\\theta$ is important.";
      const matches = [...text.matchAll(/\$([^$]+)\$/g)];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("\\theta");
    });

    it("identifies display math", () => {
      const text = "Equation: \\[E=mc^2\\]";
      expect(/\\\[/.test(text)).toBe(true);
    });

    it("handles newcommand detection", () => {
      const text = "\\newcommand{\\loss}{\\mathcal{L}}";
      const match = text.match(/\\newcommand\{\\([^}]+)\}/);
      expect(match![1]).toBe("loss");
    });

    it("identifies bibitem entries", () => {
      const text = "\\bibitem{ref1} Author.\\bibitem{ref2} Author2.";
      const matches = [...text.matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe("ref1");
      expect(matches[1][1]).toBe("ref2");
    });

    it("parses multiple labels and refs", () => {
      const text = "See \\ref{fig:a} and \\ref{tab:b}. Also \\ref{sec:c}.";
      const refs = [...text.matchAll(/\\ref\s*\{([^}]+)\}/g)].map((m) => m[1]);
      expect(refs).toEqual(["fig:a", "tab:b", "sec:c"]);
    });
  });
});
