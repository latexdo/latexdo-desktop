/*
 * How a collaborator looks to everyone else: an emoji and a color, both
 * derived from their client id, so the same person has the same look on their
 * cursor, in the avatar list and on every computer.
 */

const emojis = [
  "🦊",
  "🐼",
  "🐨",
  "🦉",
  "🐙",
  "🦁",
  "🐯",
  "🐸",
  "🐧",
  "🦄",
  "🐝",
  "🐢",
  "🦋",
  "🐳",
  "🦔",
  "🐰",
] as const;

export const collaboratorColors = [
  "#2f6fdb",
  "#1d7a56",
  "#a65f1b",
  "#8b4aa6",
  "#b42318",
  "#0f766e",
  "#6d5dfc",
  "#b45309",
] as const;

function hash(seed: string): number {
  // FNV-1a: small, stable across machines.
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export interface CollaboratorLook {
  emoji: string;
  color: string;
}

export function collaboratorLook(clientId: string): CollaboratorLook {
  const value = hash(clientId || "anonymous");
  return {
    emoji: emojis[value % emojis.length]!,
    color: collaboratorColors[(value >>> 8) % collaboratorColors.length]!,
  };
}

export interface RemoteCursor {
  /** The Yjs awareness client number y-monaco puts in its class names. */
  clientID: number;
  name: string;
  emoji: string;
  color: string;
}

function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, " ")}"`;
}

function cssColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : collaboratorColors[0];
}

/** Colors each remote cursor and labels it with the person's emoji and name. */
export function remoteCursorCss(cursors: readonly RemoteCursor[]): string {
  return cursors
    .map(({ clientID, name, emoji, color }) => {
      const id = Math.trunc(clientID);
      const tint = cssColor(color);
      const label = cssString(`${emoji} ${name || "Guest"}`.trim());
      return [
        `.monaco-editor .yRemoteSelection-${id} { background-color: ${tint}38; }`,
        `.monaco-editor .yRemoteSelectionHead-${id} { border-left-color: ${tint}; }`,
        `.monaco-editor .yRemoteSelectionHead-${id}::after { content: ${label}; background: ${tint}; }`,
      ].join("\n");
    })
    .join("\n");
}
