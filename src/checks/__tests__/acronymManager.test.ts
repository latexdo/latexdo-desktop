import { describe, it, expect } from "vitest";
import { runAcronymChecks } from "../acronymManager";
import type { AcronymManagerSettings } from "../../types";

const defaultSettings: AcronymManagerSettings = {
  enabled: true,
  checkUndefinedAcronym: true,
  checkDuplicateDefinition: true,
  checkUnusedAcronym: true,
  checkConflictingDefinitions: true,
};

function makeDoc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

describe("runAcronymChecks", () => {
  it("returns empty when disabled", () => {
    const result = runAcronymChecks("content", { ...defaultSettings, enabled: false });
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty content", () => {
    expect(runAcronymChecks("", defaultSettings)).toHaveLength(0);
  });

  describe("Undefined acronyms", () => {
    it("detects undefined acronym", () => {
      const doc = makeDoc("The CNN model achieved good results.");
      const result = runAcronymChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("CNN"))).toBe(true);
    });

    it("passes when acronym is defined as FullForm (ACRONYM)", () => {
      const doc = makeDoc(
        "Convolutional Neural Network (CNN) ... The CNN model achieved good results.",
      );
      const result = runAcronymChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("CNN"))).toBe(false);
    });

    it("handles multiple undefined acronyms", () => {
      const doc = makeDoc("The CNN and RNN models were compared.");
      const result = runAcronymChecks(doc, defaultSettings);
      const undefinedOnes = result.filter((d) =>
        d.message.includes("used without definition"),
      );
      expect(undefinedOnes.length).toBeGreaterThanOrEqual(2);
    });

    it("does not flag common short words as acronyms", () => {
      const doc = makeDoc("The and for are not acronyms. A and I are too short.");
      const result = runAcronymChecks(doc, defaultSettings);
      const undefinedAll = result.filter((d) =>
        d.message.includes("undefined acronym"),
      );
      expect(undefinedAll.length).toBe(0);
    });

    it("skips when disabled", () => {
      const doc = makeDoc("The CNN model.");
      const result = runAcronymChecks(doc, {
        ...defaultSettings,
        checkUndefinedAcronym: false,
      });
      expect(result.some((d) => d.message.includes("undefined acronym"))).toBe(false);
    });
  });

  describe("Duplicate definitions", () => {
    it("detects duplicate acronym definition (same ACRONYM in two places)", () => {
      const doc = makeDoc(
        "Convolutional Neural Network (CNN) ... Cascade Neural Network (CNN)",
      );
      const result = runAcronymChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("defined multiple times"))).toBe(
        true,
      );
    });

    it("skips when disabled", () => {
      const doc = makeDoc("A (CNN) ... B (CNN)");
      const result = runAcronymChecks(doc, {
        ...defaultSettings,
        checkDuplicateDefinition: false,
      });
      expect(result.some((d) => d.message.includes("duplicate"))).toBe(false);
    });
  });

  describe("Unused acronyms", () => {
    it("detects defined but never used acronym", () => {
      const doc = makeDoc("Some Full Form (SFF) is defined.") + "\n\\end{document}";
      const result = runAcronymChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("never used again"))).toBe(true);
    });

    it("passes when defined acronym is later used", () => {
      const doc = makeDoc(
        "Convolutional Neural Network (CNN) ... The CNN model works well.",
      );
      const result = runAcronymChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("unused"))).toBe(false);
    });

    it("skips when disabled", () => {
      const doc = makeDoc("Full Form (FF) is defined.");
      const result = runAcronymChecks(doc, {
        ...defaultSettings,
        checkUnusedAcronym: false,
      });
      expect(result.some((d) => d.message.includes("unused"))).toBe(false);
    });
  });

  describe("Conflicting definitions", () => {
    it("detects conflicting definitions for same acronym", () => {
      const doc = makeDoc("Convolutional (CNN) and Cascade (CNN)");
      const result = runAcronymChecks(doc, defaultSettings);
      expect(
        result.some(
          (d) => d.message.includes("conflicting") || d.message.includes("Conflicting"),
        ),
      ).toBe(true);
    });

    it("skips when disabled", () => {
      const doc = makeDoc("A (CNN) ... B (CNN)");
      const result = runAcronymChecks(doc, {
        ...defaultSettings,
        checkConflictingDefinitions: false,
      });
      expect(result.some((d) => d.message.includes("conflicting"))).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("handles document with no acronyms", () => {
      const doc = makeDoc("This paper presents a method for solving problems.");
      const result = runAcronymChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles acronyms in math mode", () => {
      const doc = makeDoc("The $CNN$ model has $RNN$ layers.");
      const result = runAcronymChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles very large content", () => {
      const doc = makeDoc(Array(5000).fill("word").join(" ") + " CNN ");
      const result = runAcronymChecks(doc, defaultSettings);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles acronyms defined with parentheses after a long text", () => {
      const doc = makeDoc(
        "A very long description of something called Convolutional Neural Network (CNN) ... then CNN is used throughout.",
      );
      const result = runAcronymChecks(doc, defaultSettings);
      expect(result.some((d) => d.message.includes("CNN"))).toBe(false);
    });
  });
});
