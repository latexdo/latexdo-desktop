#!/usr/bin/env bash
#
# LatexDo collaboration server — one-command installer for a fresh Linux VPS.
#
# It installs Node.js, nginx and the service, hardens the box, turns on HTTPS,
# configures the firewall, and starts everything. Safe to re-run (idempotent).
#
# Usage (run as root, from inside the repo):
#
#   sudo DOMAIN=collaborations.example.com EMAIL=you@example.com \
#        ALLOWED_ORIGINS="latexdo://app" \
#        bash collaborations/install.sh
#
# DOMAIN  – public hostname that points (DNS A/AAAA) at this server. Required
#           for HTTPS; omit to install HTTP-only on port 80.
# EMAIL   – contact address for the Let's Encrypt certificate. Required for HTTPS.
# ALLOWED_ORIGINS – comma-separated browser origins allowed to call the API.
#           Defaults to the LatexDo editor + desktop app. "*" allows everything
#           (not recommended in production).
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APP_USER="latexdo"
APP_DIR="/opt/latexdo"
DATA_DIR="/var/lib/latexdo-collaborations"
ENV_DIR="/etc/latexdo"
ENV_FILE="${ENV_DIR}/collaborations.env"
SERVICE_NAME="latexdo-collaborations"
PORT="8787"
NODE_MAJOR="22"

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-latexdo://app}"
SHARE_URL_BASE="${SHARE_URL_BASE:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${REPO_ROOT}/collaborations"

log()  { printf '\033[1;34m[latexdo]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[latexdo]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[latexdo]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root:  sudo bash collaborations/install.sh"
command -v apt-get >/dev/null 2>&1 || die "This installer supports Debian/Ubuntu (apt) systems."
[ -f "${SRC_DIR}/server.mjs" ] || die "Cannot find server.mjs next to this script."

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
log "Installing base packages..."
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw nginx

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  log "Installing Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
log "Node.js $(node -v) ready."

# ---------------------------------------------------------------------------
# 2. Service user and directories
# ---------------------------------------------------------------------------
if ! id "${APP_USER}" >/dev/null 2>&1; then
  log "Creating service user '${APP_USER}'..."
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi

mkdir -p "${APP_DIR}" "${DATA_DIR}" "${ENV_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"
chmod 750 "${DATA_DIR}"

# ---------------------------------------------------------------------------
# 3. Application code + dependencies
# ---------------------------------------------------------------------------
log "Installing application into ${APP_DIR}..."
install -m 0644 "${SRC_DIR}/server.mjs"  "${APP_DIR}/server.mjs"
install -m 0644 "${SRC_DIR}/security.mjs" "${APP_DIR}/security.mjs"
install -m 0644 "${SRC_DIR}/package.json" "${APP_DIR}/package.json"
( cd "${APP_DIR}" && npm install --omit=dev --no-audit --no-fund )
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# ---------------------------------------------------------------------------
# 4. Environment file (created once; existing file is preserved)
# ---------------------------------------------------------------------------
if [ ! -f "${ENV_FILE}" ]; then
  log "Writing ${ENV_FILE}..."
  PUBLIC_ORIGIN=""
  [ -n "${DOMAIN}" ] && PUBLIC_ORIGIN="https://${DOMAIN}"
  cat > "${ENV_FILE}" <<EOF
# LatexDo collaboration server configuration.
# Restart after editing:  systemctl restart ${SERVICE_NAME}

# Bind to localhost only; nginx terminates TLS and proxies to it.
LATEXDO_COLLAB_HOST=127.0.0.1
LATEXDO_COLLAB_PORT=${PORT}
LATEXDO_COLLAB_DATA_DIR=${DATA_DIR}
LATEXDO_COLLAB_PUBLIC_ORIGIN=${PUBLIC_ORIGIN}
LATEXDO_COLLAB_SHARE_URL_BASE=${SHARE_URL_BASE}

# Only these browser origins may call the API. Never use "*" in production.
LATEXDO_COLLAB_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}

# We sit behind nginx, so trust its X-Forwarded-For for per-IP rate limiting.
LATEXDO_COLLAB_TRUST_PROXY=true

# Abuse limits (safe defaults; tune for your traffic).
LATEXDO_COLLAB_RATE_MAX=600
LATEXDO_COLLAB_CREATE_RATE_MAX=30
LATEXDO_COLLAB_MAX_PROJECTS=250000
LATEXDO_COLLAB_MAX_CONNECTIONS=30000
LATEXDO_COLLAB_ACCESS_LOG=true
EOF
  chmod 640 "${ENV_FILE}"
  chown root:"${APP_USER}" "${ENV_FILE}"
else
  warn "Keeping existing ${ENV_FILE} (edit it by hand to change settings)."
fi

# ---------------------------------------------------------------------------
# 5. systemd service
# ---------------------------------------------------------------------------
log "Installing systemd service..."
install -m 0644 "${SRC_DIR}/systemd/${SERVICE_NAME}.service" \
  "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

# ---------------------------------------------------------------------------
# 6. nginx reverse proxy
# ---------------------------------------------------------------------------
log "Configuring nginx..."
NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}.conf"
SERVER_NAME="${DOMAIN:-_}"
sed "s/collaborations.example.com/${SERVER_NAME}/g" \
  "${SRC_DIR}/nginx/${SERVICE_NAME}.conf" > "${NGINX_SITE}"
ln -sf "${NGINX_SITE}" "/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
# 7. Firewall
# ---------------------------------------------------------------------------
log "Configuring firewall (ufw)..."
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
# Port ${PORT} is bound to localhost and never exposed directly.
yes | ufw enable >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 8. HTTPS via Let's Encrypt
# ---------------------------------------------------------------------------
if [ -n "${DOMAIN}" ] && [ -n "${EMAIL}" ]; then
  log "Obtaining HTTPS certificate for ${DOMAIN}..."
  apt-get install -y certbot python3-certbot-nginx
  if certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
       -m "${EMAIL}" --redirect; then
    systemctl reload nginx
    log "HTTPS is active."
  else
    warn "certbot failed. Check that ${DOMAIN}'s DNS points to this server, then run:"
    warn "  certbot --nginx -d ${DOMAIN} -m ${EMAIL} --agree-tos --redirect"
  fi
else
  warn "No DOMAIN/EMAIL given — installed HTTP-only. For HTTPS, re-run with:"
  warn "  sudo DOMAIN=your.host EMAIL=you@example.com bash collaborations/install.sh"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo
log "Installation complete."
systemctl --no-pager --lines=0 status "${SERVICE_NAME}" || true
echo
log "Health check:   curl -s http://127.0.0.1:${PORT}/api/health"
log "Live logs:      bash ${SRC_DIR}/logs.sh          (or: journalctl -u ${SERVICE_NAME} -f)"
log "Restart:        systemctl restart ${SERVICE_NAME}"
log "Edit config:    ${ENV_FILE}"
[ -n "${DOMAIN}" ] && log "Public URL:     https://${DOMAIN}/api/health"
