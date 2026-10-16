#!/usr/bin/env sh
set -eu

CLI_URL="${LATEXDO_CLI_URL:-https://latexdo.org/bin/latexdo}"
CLI_SHA256="${LATEXDO_CLI_SHA256:-f02d361fe34ee9d7954e38dcd3bbb56f933c821ae4bf2dfccc5980caad83937a}"
INSTALL_DIR="${LATEXDO_BIN_DIR:-$HOME/.local/bin}"
TARGET="$INSTALL_DIR/latexdo"

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'latexdo install: %s\n' "$*" >&2
}

die() {
  warn "$*"
  exit 1
}

confirm_privacy_consent() {
  if [ "${LATEXDO_ACCEPT_PRIVACY:-0}" = "1" ]; then
    return
  fi

  if [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
    die "Installation requires privacy consent. Set LATEXDO_ACCEPT_PRIVACY=1 to accept non-interactively."
  fi

  cat >/dev/tty <<'NOTICE'
LatexDo privacy and consent

LatexDo does not currently collect personal analytics, sell user data, or track your documents.
LatexDo stores app settings, trusted folder choices, editor preferences, and install state on this device.
LatexDo reads and writes files in folders you create, open, or trust. Update checks, downloads, extension catalog access, external links, and optional proofreading can contact LatexDo services or the provider you configure.

Privacy information: https://www.latexdo.org/privacy
NOTICE

  printf '%s' 'Type "yes" to accept and continue installing LatexDo: ' >/dev/tty
  if ! IFS= read -r answer </dev/tty; then
    die "Could not read consent from the terminal."
  fi

  case "$answer" in
    yes | YES | Yes | y | Y) ;;
    *)
      die "Installation canceled. Set LATEXDO_ACCEPT_PRIVACY=1 to accept non-interactively."
      ;;
  esac
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

download() {
  url="$1"
  output="$2"

  if command_exists curl; then
    curl -fsSL "$url" -o "$output"
    return
  fi

  if command_exists wget; then
    wget -qO "$output" "$url"
    return
  fi

  die "curl or wget is required to download LatexDo CLI."
}

sha256_file() {
  if command_exists shasum; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command_exists sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  elif command_exists openssl; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    die "shasum, sha256sum, or openssl is required to verify the CLI download."
  fi
}

make_temp_file() {
  if command_exists mktemp; then
    mktemp "${TMPDIR:-/tmp}/latexdo.XXXXXX"
  else
    printf '%s\n' "${TMPDIR:-/tmp}/latexdo.$$"
  fi
}

confirm_privacy_consent

mkdir -p "$INSTALL_DIR"
tmp_file="$(make_temp_file)"
trap 'rm -f "$tmp_file"' EXIT INT TERM

log "Downloading LatexDo CLI"
download "$CLI_URL" "$tmp_file"

if [ "${#CLI_SHA256}" -ne 64 ]; then
  die "LATEXDO_CLI_SHA256 must be exactly 64 hexadecimal characters."
fi
case "$CLI_SHA256" in
  *[!a-fA-F0-9]*) die "LATEXDO_CLI_SHA256 must contain only hexadecimal characters." ;;
esac
actual_sha256="$(sha256_file "$tmp_file")"
if [ "$(printf '%s' "$actual_sha256" | tr 'A-F' 'a-f')" != "$(printf '%s' "$CLI_SHA256" | tr 'A-F' 'a-f')" ]; then
  die "Downloaded CLI failed SHA-256 verification."
fi

chmod 0755 "$tmp_file"
mv "$tmp_file" "$TARGET"
trap - EXIT INT TERM

log "Installed latexdo to $TARGET"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    warn "$INSTALL_DIR is not in PATH."
    warn "Add this to your shell profile: export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

if [ "${LATEXDO_SKIP_BOOTSTRAP:-0}" != "1" ]; then
  log "Bootstrapping LatexDo source and npm dependencies"
  "$TARGET" update
fi

log "Run: latexdo"
