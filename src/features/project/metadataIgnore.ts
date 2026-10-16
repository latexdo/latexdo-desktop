/** Keep local history and other LatexDo metadata out of new Git commits. */
export async function ensureMetadataIgnore(projectId: string): Promise<void> {
  const path = ".latexdo/.gitignore";
  if (await window.latexdo.fileExists(projectId, path)) return;
  await window.latexdo.writeFile(
    projectId,
    path,
    "# LatexDo local history, recovery and workspace metadata\n*\n",
  );
}
