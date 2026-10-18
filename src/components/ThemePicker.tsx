import { colorThemeOptions, type ColorTheme } from "../features/settings/settings";

export type ThemeAppearance = "light" | "dark";

interface ThemePickerProps {
  colorTheme: ColorTheme;
  /** What the app shows now, so the matching card is the selected one. */
  appearance: ThemeAppearance;
  onChoose: (theme: ColorTheme, appearance: ThemeAppearance) => void;
}

/**
 * Every theme in both its light and dark look, each card painted in its own
 * colors. Settings and setup both use it, so they always offer the same choice.
 */
export function ThemePicker({ colorTheme, appearance, onChoose }: ThemePickerProps) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Application theme">
      {(["dark", "light"] as const).flatMap((look) =>
        colorThemeOptions.map((theme) => {
          const [background, accent, text] = theme.swatches[look];
          const selected = colorTheme === theme.id && appearance === look;
          const lookName = look === "dark" ? "Dark" : "Light";
          return (
            <button
              key={`${theme.id}-${look}`}
              type="button"
              className={`theme-choice ${selected ? "active" : ""}`}
              style={{ background, color: text }}
              onClick={() => onChoose(theme.id, look)}
              role="radio"
              aria-checked={selected}
              aria-label={`${theme.name} ${lookName}`}
              title={theme.description}
            >
              <span className="theme-choice-accent" style={{ background: accent }} />
              <strong>{theme.name}</strong>
              <small>{lookName}</small>
            </button>
          );
        }),
      )}
    </div>
  );
}
