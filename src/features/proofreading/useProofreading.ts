import { useEffect, useMemo, useState } from "react";
import type {
  ProofreadingResult,
  ProofreadingSettings,
  SpellCheckerSettings,
} from "../../types";
import { setCustomDictionaryWords } from "./customDictionary";

export function useProofreading() {
  const [spellCheckerSettings, setSpellCheckerSettings] =
    useState<SpellCheckerSettings | null>(null);
  const [spellCheckerLoading, setSpellCheckerLoading] = useState(false);
  const [spellCheckerError, setSpellCheckerError] = useState("");
  const [spellCheckerWordDraft, setSpellCheckerWordDraft] = useState("");
  const [spellCheckerLanguageQuery, setSpellCheckerLanguageQuery] = useState("");
  const [proofreadingSettings, setProofreadingSettings] =
    useState<ProofreadingSettings | null>(null);
  const [proofreadingResult, setProofreadingResult] =
    useState<ProofreadingResult | null>(null);
  const [proofreadingLoading, setProofreadingLoading] = useState(false);
  const [proofreadingError, setProofreadingError] = useState("");

  useEffect(() => {
    setCustomDictionaryWords(spellCheckerSettings?.customWords ?? []);
  }, [spellCheckerSettings?.customWords]);

  const filteredSpellCheckerLanguages = useMemo(() => {
    const query = spellCheckerLanguageQuery.trim().toLowerCase();
    const languages = spellCheckerSettings?.availableLanguages ?? [];
    if (!query) {
      return languages;
    }

    return languages.filter((language) => language.toLowerCase().includes(query));
  }, [spellCheckerLanguageQuery, spellCheckerSettings?.availableLanguages]);

  return {
    spellCheckerSettings,
    setSpellCheckerSettings,
    spellCheckerLoading,
    setSpellCheckerLoading,
    spellCheckerError,
    setSpellCheckerError,
    spellCheckerWordDraft,
    setSpellCheckerWordDraft,
    spellCheckerLanguageQuery,
    setSpellCheckerLanguageQuery,
    proofreadingSettings,
    setProofreadingSettings,
    proofreadingResult,
    setProofreadingResult,
    proofreadingLoading,
    setProofreadingLoading,
    proofreadingError,
    setProofreadingError,
    filteredSpellCheckerLanguages,
  };
}
