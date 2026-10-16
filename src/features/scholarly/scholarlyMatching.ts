import { authorLastNames, titleTokens } from "../graph/knowledgeGraph";

export function tokenSimilarity(
  titleA: string | undefined,
  titleB: string | undefined,
): number {
  const a = titleTokens(titleA);
  const b = titleTokens(titleB);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export function authorSimilarity(
  entryAuthorField: string | undefined,
  candidateAuthors: string[],
): number {
  const entryLastNames = authorLastNames(entryAuthorField);
  const candidateLastNames = new Set(
    candidateAuthors.flatMap((author) => authorLastNames(author)),
  );
  if (entryLastNames.length === 0) return 0;
  const matched = entryLastNames.filter((name) => candidateLastNames.has(name));
  return matched.length / entryLastNames.length;
}
