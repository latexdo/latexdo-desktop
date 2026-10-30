import { Palette } from "lucide-react";
import { pdfReadingThemes, type PdfReadingTheme } from "../features/pdf/readingThemes";

export function PdfThemePicker({
  value,
  onChange,
}: {
  value: PdfReadingTheme;
  onChange: (theme: PdfReadingTheme) => void;
}) {
  return (
    <label
      className="pdf-theme-picker"
      title="PDF reading theme — changes the preview only"
    >
      <Palette size={14} aria-hidden="true" />
      <select
        aria-label="PDF reading theme"
        value={value}
        onChange={(event) => onChange(event.target.value as PdfReadingTheme)}
      >
        {pdfReadingThemes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
    </label>
  );
}
