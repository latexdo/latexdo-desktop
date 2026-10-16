#!/usr/bin/env bash

set -euo pipefail

dmg_path="${1:-}"
expected_team_id="${2:-}"
if [[ -z "$dmg_path" || ! -f "$dmg_path" || ! "$expected_team_id" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "Usage: $0 /path/to/LatexDo.dmg APPLE_TEAM_ID" >&2
  exit 1
fi

mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/latexdo-dmg.XXXXXX")"
cleanup() {
  hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
  rmdir "$mount_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$mount_dir" -quiet

app_path="$(find "$mount_dir" -maxdepth 1 -type d -name 'LatexDo.app' -print -quit)"
if [[ -z "$app_path" ]]; then
  echo "LatexDo.app was not found in $dmg_path" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$app_path"
spctl --assess --verbose=4 --type execute "$app_path"
xcrun stapler validate "$app_path"

signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
if ! grep -q '^Authority=Developer ID Application:' <<<"$signature_details"; then
  echo "The application is not signed with a Developer ID Application certificate." >&2
  exit 1
fi

if ! grep -q '^Identifier=com.latexdo.editor$' <<<"$signature_details"; then
  echo "The signed application does not use the com.latexdo.editor bundle ID." >&2
  exit 1
fi

if ! grep -q "^TeamIdentifier=${expected_team_id}$" <<<"$signature_details"; then
  echo "The application was not signed by the configured Apple developer team." >&2
  exit 1
fi

echo "Verified Developer ID signature, notarization ticket, and Gatekeeper acceptance."
