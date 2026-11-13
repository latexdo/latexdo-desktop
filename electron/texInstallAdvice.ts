/**
 * Install advice for the TeX tools LatexDo needs, worded for the computer it
 * runs on: a Mac user is told about MacTeX only, never MiKTeX.
 */
export type TexPlatform = "macos" | "windows" | "linux";

export function texPlatform(platform: NodeJS.Platform = process.platform): TexPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

/** What to install so LatexDo can build PDFs. */
export function latexToolchainInstallAdvice(platform?: NodeJS.Platform): string {
  switch (texPlatform(platform)) {
    case "macos":
      return "Install MacTeX (tug.org/mactex). Then restart LatexDo and press Compile again.";
    case "windows":
      return "Install MiKTeX (miktex.org/download) and allow it to install missing packages. Then restart LatexDo and press Compile again.";
    default:
      return "Install TeX Live with latexmk from your package manager (for example texlive-full). Then restart LatexDo and press Compile again.";
  }
}

/** What to install so LatexDo can render .asy drawings. */
export function asymptoteInstallAdvice(platform?: NodeJS.Platform): string {
  switch (texPlatform(platform)) {
    case "macos":
      return 'Install MacTeX, which includes Asymptote, or run "brew install asymptote". Then restart LatexDo and compile again.';
    case "windows":
      return "Install Asymptote from asymptote.sourceforge.io (or add it with the MiKTeX Console). Then restart LatexDo and compile again.";
    default:
      return "Install the asymptote package from your package manager. Then restart LatexDo and compile again.";
  }
}

/** What to install so source ↔ PDF sync works. */
export function synctexInstallAdvice(platform?: NodeJS.Platform): string {
  switch (texPlatform(platform)) {
    case "macos":
      return "Install MacTeX and restart LatexDo.";
    case "windows":
      return "Install MiKTeX and restart LatexDo.";
    default:
      return "Install TeX Live from your package manager and restart LatexDo.";
  }
}

/** How to add one missing LaTeX package to the local TeX installation. */
export function latexPackageInstallAdvice(
  packageName: string,
  platform?: NodeJS.Platform,
): string {
  switch (texPlatform(platform)) {
    case "macos":
      return `Install it with TeX Live Utility (included in MacTeX) or "sudo tlmgr install ${packageName}"`;
    case "windows":
      return `Install ${packageName} from the MiKTeX Console, or let MiKTeX install it when asked`;
    default:
      return `Install it with "tlmgr install ${packageName}" or your distribution's texlive package`;
  }
}
