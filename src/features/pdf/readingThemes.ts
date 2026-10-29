/** Display-only PDF themes; the document bytes and exports remain original. */
export const pdfReadingThemes = [
  { id: "original", label: "Original", paper: "#ffffff", ink: "#171717" },
  { id: "sepia", label: "Sepia", paper: "#f7eedb", ink: "#352e25" },
  { id: "dark", label: "Dark", paper: "#181818", ink: "#d5d5d5" },
  { id: "midnight", label: "Midnight", paper: "#17232e", ink: "#d4e3ef" },
  {
    id: "system",
    label: "Follow app",
    paper: "linear-gradient(135deg, #fff 50%, #181818 50%)",
    ink: "#8290a0",
  },
] as const;

export type PdfReadingTheme = (typeof pdfReadingThemes)[number]["id"];

export function isPdfReadingTheme(value: unknown): value is PdfReadingTheme {
  return pdfReadingThemes.some((theme) => theme.id === value);
}
