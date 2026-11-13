/**
 * User-chosen keyboard shortcuts for the application menu.
 *
 * Every menu command has a default accelerator in the menu template; the user
 * can replace it, remove it ("") or give one to a command that has none. Only
 * the differences from the defaults are stored, so new defaults in a later
 * release still reach everyone who did not change that command.
 */

export const shortcutOverridesFile = "keyboard-shortcuts.json";
const shortcutOverridesSchemaVersion = 1;
const maxShortcutOverrides = 500;
const maxShortcutIdLength = 200;

/** Shortcut id → Electron accelerator, or "" when the user removed the key. */
export type ShortcutOverrides = Record<string, string>;

const modifierAliases: Record<string, string> = {
  cmdorctrl: "CmdOrCtrl",
  commandorcontrol: "CmdOrCtrl",
  cmd: "Cmd",
  command: "Cmd",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Super",
  meta: "Super",
};

const namedKeys = new Set([
  "Enter",
  "Return",
  "Tab",
  "Space",
  "Backspace",
  "Delete",
  "Up",
  "Down",
  "Left",
  "Right",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Plus",
  "Escape",
]);
const punctuationKeys = new Set([
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
  "`",
]);

function canonicalKey(key: string): string | null {
  if (/^[A-Za-z0-9]$/.test(key)) return key.toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (punctuationKeys.has(key)) return key;
  const named = [...namedKeys].find((name) => name.toLowerCase() === key.toLowerCase());
  return named ?? null;
}

function isFunctionKey(key: string): boolean {
  return /^F\d+$/.test(key);
}

/**
 * Splits an accelerator into its modifiers and key. "CmdOrCtrl+-" and
 * "CmdOrCtrl+Plus" both parse; anything Electron would reject returns null.
 */
export function parseAccelerator(
  accelerator: string,
): { modifiers: string[]; key: string } | null {
  if (!accelerator || accelerator.length > 64) return null;
  // A trailing "+" is not a key here; "Plus" names it.
  const parts = accelerator.split("+");
  if (parts.some((part) => part === "")) return null;
  const rawKey = parts.pop()!;
  const modifiers: string[] = [];
  for (const part of parts) {
    const modifier = modifierAliases[part.toLowerCase()];
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  const key = canonicalKey(rawKey);
  if (!key) return null;
  return { modifiers, key };
}

/**
 * A shortcut the user may set: a known key with at least one of Cmd, Ctrl,
 * Alt or Super, so plain typing and Shift+letter are never captured. Function
 * keys may stand alone.
 */
export function isAssignableAccelerator(accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed || parsed.key === "Escape") return false;
  if (isFunctionKey(parsed.key)) return true;
  return parsed.modifiers.some((modifier) => modifier !== "Shift");
}

/**
 * The physical keys an accelerator stands for on this platform, so
 * "CmdOrCtrl+T" and "Cmd+T" compare equal on a Mac.
 */
export function acceleratorSignature(accelerator: string, mac: boolean): string | null {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return null;
  const modifiers = parsed.modifiers.map((modifier) => {
    if (modifier === "CmdOrCtrl") return mac ? "Cmd" : "Ctrl";
    if (modifier === "Super" && mac) return "Cmd";
    return modifier;
  });
  const key = parsed.key === "Return" ? "Enter" : parsed.key;
  return [...new Set(modifiers)].sort().concat(key).join("+");
}

/** The parts of an Electron `before-input-event` input that name a key. */
export interface RecordedKeyInput {
  type: string;
  code: string;
  key: string;
  shift: boolean;
  control: boolean;
  alt: boolean;
  meta: boolean;
}

const codeKeys: Record<string, string> = {
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Space: "Space",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  Escape: "Escape",
};

/**
 * Turns a key press into an accelerator. Uses the physical key (`code`) so
 * Alt+letter on a Mac records the letter, not the symbol it types. Returns
 * null while only modifiers are held.
 */
export function acceleratorFromInput(
  input: RecordedKeyInput,
  mac: boolean,
): string | null {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(input.code)) key = input.code.slice(3);
  else if (/^Digit[0-9]$/.test(input.code)) key = input.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(input.code)) key = input.code;
  else key = codeKeys[input.code];
  if (!key) return null;
  const modifiers: string[] = [];
  // The platform's main modifier is stored as CmdOrCtrl, like the defaults.
  if (mac ? input.meta : input.control) modifiers.push("CmdOrCtrl");
  if (mac && input.control) modifiers.push("Ctrl");
  if (input.alt) modifiers.push("Alt");
  if (input.shift) modifiers.push("Shift");
  if (!mac && input.meta) modifiers.push("Super");
  return [...modifiers, key].join("+");
}

/** Reads the stored file, dropping anything malformed. */
export function parseShortcutOverrides(raw: unknown): ShortcutOverrides {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as { version?: unknown; overrides?: unknown };
  if (value.version !== shortcutOverridesSchemaVersion) return {};
  if (!value.overrides || typeof value.overrides !== "object") return {};
  const overrides: ShortcutOverrides = {};
  for (const [id, accelerator] of Object.entries(value.overrides).slice(
    0,
    maxShortcutOverrides,
  )) {
    if (!id || id.length > maxShortcutIdLength || typeof accelerator !== "string") {
      continue;
    }
    if (accelerator === "" || isAssignableAccelerator(accelerator)) {
      overrides[id] = accelerator;
    }
  }
  return overrides;
}

export function serializeShortcutOverrides(overrides: ShortcutOverrides): string {
  return JSON.stringify(
    { version: shortcutOverridesSchemaVersion, overrides },
    null,
    2,
  );
}
