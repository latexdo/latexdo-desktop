/*
 * Visual Studio Code's Codicons, drawn from the font Monaco already ships, so
 * Source Control uses the same thin icons as VS Code.
 *
 * Codicons: Copyright (c) Microsoft Corporation, CC BY 4.0 (icons) and MIT
 * (code). https://github.com/microsoft/vscode-codicons
 */

import type { CSSProperties } from "react";
import codiconFontUrl from "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf?url";
import "./codicon.css";

let fontRequested = false;

/** Registers the font once, under a name of our own so Monaco's is untouched. */
function ensureCodiconFont(): void {
  if (fontRequested || typeof FontFace === "undefined" || !document.fonts) return;
  fontRequested = true;
  const face = new FontFace("latexdo-codicon", `url(${codiconFontUrl})`);
  document.fonts.add(face);
  void face.load().catch(() => {
    // Without the font the icons are blank; every button keeps its label.
  });
}

const glyphs = {
  account: 0xeb99,
  add: 0xea60,
  "arrow-down": 0xea9a,
  "arrow-up": 0xeaa1,
  check: 0xeab2,
  "chevron-down": 0xeab4,
  "chevron-right": 0xeab6,
  "circle-filled": 0xea71,
  "circle-large-outline": 0xebb5,
  close: 0xea76,
  cloud: 0xebaa,
  "cloud-upload": 0xeac3,
  copy: 0xebcc,
  discard: 0xeae2,
  ellipsis: 0xea7c,
  error: 0xea87,
  file: 0xea7b,
  "file-code": 0xeae9,
  "file-media": 0xeaea,
  "file-pdf": 0xeaeb,
  folder: 0xea83,
  "folder-opened": 0xeaf7,
  "git-branch": 0xea68,
  "git-commit": 0xeafc,
  "git-compare": 0xeafd,
  "git-merge": 0xeafe,
  "git-stash": 0xec26,
  "go-to-file": 0xea94,
  history: 0xea82,
  json: 0xeb0f,
  "list-flat": 0xeb84,
  "list-tree": 0xeb86,
  loading: 0xeb19,
  markdown: 0xeb1d,
  pass: 0xeba4,
  refresh: 0xeb37,
  remove: 0xeb3b,
  "repo-fetch": 0xec1d,
  "repo-pull": 0xeb40,
  "repo-push": 0xeb41,
  sparkle: 0xec10,
  sync: 0xea77,
  table: 0xebb7,
  tag: 0xea66,
  target: 0xebf8,
  warning: 0xea6c,
} as const;

export type CodiconName = keyof typeof glyphs;

export function Codicon({
  name,
  className,
  spin,
  style,
}: {
  name: CodiconName;
  className?: string;
  spin?: boolean;
  style?: CSSProperties;
}) {
  ensureCodiconFont();
  return (
    <span
      className={["scm-codicon", spin ? "spin" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      aria-hidden="true"
    >
      {String.fromCharCode(glyphs[name])}
    </span>
  );
}

/** The icon VS Code shows for a file of this type. */
export function fileCodicon(path: string): CodiconName {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (
    ["tex", "sty", "cls", "bib", "bst", "ltx", "tikz", "js", "ts", "py"].includes(
      extension,
    )
  )
    return "file-code";
  if (extension === "pdf") return "file-pdf";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "eps", "drawio"].includes(extension))
    return "file-media";
  if (["csv", "tsv", "xlsx"].includes(extension)) return "table";
  if (extension === "md") return "markdown";
  if (extension === "json") return "json";
  return "file";
}
