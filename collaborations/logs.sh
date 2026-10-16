#!/usr/bin/env bash
#
# Show LatexDo collaboration server logs — "everything" in one place.
#
#   bash collaborations/logs.sh            # follow live service logs
#   bash collaborations/logs.sh 500        # last 500 lines, then follow
#   bash collaborations/logs.sh errors     # only warnings/errors, follow
#   bash collaborations/logs.sh nginx      # follow nginx access + error logs
#   bash collaborations/logs.sh status     # one-shot health + service status
#
set -euo pipefail
SERVICE_NAME="latexdo-collaborations"
PORT="8787"
MODE="${1:-follow}"

case "${MODE}" in
  status)
    echo "== service =="
    systemctl --no-pager status "${SERVICE_NAME}" || true
    echo; echo "== health =="
    curl -s "http://127.0.0.1:${PORT}/api/health" || echo "(no response on 127.0.0.1:${PORT})"
    echo
    ;;
  errors)
    journalctl -u "${SERVICE_NAME}" -f -o cat | grep --line-buffered -E '"level":"(warn|error)"|error' ;;
  nginx)
    tail -n 100 -f /var/log/nginx/latexdo-collaborations.access.log \
                   /var/log/nginx/latexdo-collaborations.error.log ;;
  ''|follow)
    journalctl -u "${SERVICE_NAME}" -f -o cat ;;
  *[0-9]*)
    journalctl -u "${SERVICE_NAME}" -n "${MODE}" -f -o cat ;;
  *)
    journalctl -u "${SERVICE_NAME}" -f -o cat ;;
esac
