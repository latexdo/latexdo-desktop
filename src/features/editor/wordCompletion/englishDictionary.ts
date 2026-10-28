// Common English words for word completion, from SCOWL via wordlist-english
// (word lists Copyright 2000-2016 Kevin Atkinson; see the package's Copyright
// file). SCOWL sizes 10–50 cover everyday and academic vocabulary; a smaller
// size means a more common word. Loaded on first use, in its own chunk.

import { sortDictionary, type DictionaryWord } from "./wordCompletion";

type WordList = { default: string[] };

const tiers: Array<[number, () => Promise<WordList>[]]> = [
  [0, () => [import("wordlist-english/english-words-10.json"), import("wordlist-english/american-words-10.json")]],
  [1, () => [import("wordlist-english/english-words-20.json"), import("wordlist-english/american-words-20.json")]],
  [2, () => [import("wordlist-english/english-words-35.json"), import("wordlist-english/american-words-35.json")]],
  [3, () => [import("wordlist-english/english-words-40.json"), import("wordlist-english/american-words-40.json")]],
  [4, () => [import("wordlist-english/english-words-50.json"), import("wordlist-english/american-words-50.json")]],
];

// Possessives ("cat's") and single letters only add noise to completion.
const usable = (word: string) => word.length > 1 && !word.includes("'");

let loading: Promise<DictionaryWord[]> | null = null;

/** The dictionary, sorted for prefix search. Loads once; [] if it fails. */
export function loadEnglishDictionary(): Promise<DictionaryWord[]> {
  loading ??= Promise.all(
    tiers.map(async ([tier, load]) => {
      const lists = await Promise.all(load());
      return lists.flatMap((list) =>
        list.default
          .filter(usable)
          .map((word) => ({ word, key: word.toLowerCase(), tier })),
      );
    }),
  )
    .then((groups) => sortDictionary(groups.flat()))
    .catch(() => {
      loading = null;
      return [];
    });
  return loading;
}
