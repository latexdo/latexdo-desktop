# Deploying the LatexDo collaboration server

One Node process behind nginx on a Linux VPS. This guide is the whole thing.

## TL;DR — one command

On a fresh **Ubuntu 22.04 / 24.04** (or Debian 12) server, as root, with your
domain's DNS already pointing at the box:

```bash
git clone https://github.com/latexdo/latexdo.git
cd latexdo
sudo DOMAIN=collaborations.example.com EMAIL=you@example.com \
     bash collaborations/install.sh
```

That single command:

1. installs Node.js 22 + nginx,
2. creates a locked-down `latexdo` service user,
3. installs the server to `/opt/latexdo` with only its 3 runtime dependencies,
4. writes hardened config to `/etc/latexdo/collaborations.env`,
5. installs and starts the `latexdo-collaborations` systemd service,
6. configures nginx as a reverse proxy (with WebSocket + rate limiting),
7. turns on the UFW firewall (only 22/80/443 open; the app port 8787 stays on
   localhost),
8. obtains a free HTTPS certificate and enables auto-renewal.

Re-running it is safe — it updates the code and restarts, and keeps your
existing `.env`.

When it finishes, verify:

```bash
curl https://collaborations.example.com/api/health
# {"ok":true,"product":"LatexDo collaborations",...}
```

## Point the app at your server

In the desktop build, set the API base URL (already defaults to
`https://collaborations.example.com`):

```
VITE_LATEXDO_API_BASE_URL=https://collaborations.example.com
```

## Logs — everything, one place

Structured JSON logs (no tokens are ever logged) go to the systemd journal.

```bash
bash collaborations/logs.sh          # follow live
bash collaborations/logs.sh 500      # last 500 lines then follow
bash collaborations/logs.sh errors   # only warnings/errors
bash collaborations/logs.sh nginx    # nginx access + error logs
bash collaborations/logs.sh status   # health + service status snapshot

# or directly:
journalctl -u latexdo-collaborations -f
```

## Day-two operations

```bash
systemctl restart latexdo-collaborations     # restart
systemctl status  latexdo-collaborations     # is it running?
nano /etc/latexdo/collaborations.env         # change settings, then restart
```

Data (projects, files, share tokens) lives in
`/var/lib/latexdo-collaborations`. Back that directory up.

## What the server protects itself against

All of these are enforced in `server.mjs` and tunable via the env file:

| Risk                                 | Protection                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Flood of requests / project creation | Per-IP rate limit (`RATE_MAX`, `CREATE_RATE_MAX`) + nginx `limit_req`         |
| Disk fill via unlimited projects     | Global project cap (`MAX_PROJECTS`)                                           |
| Disk/RAM fill via one huge document  | Per-document size cap (`MAX_DOC_CHARS`), enforced on both HTTP and live edits |
| Files/dirs flooding a project        | `maxProjectFiles` / project byte quota                                        |
| Memory leak from open documents      | Idle rooms are evicted from memory                                            |
| Held-open idle sockets               | WebSocket idle timeout + heartbeat, connection caps                           |
| Token leakage in logs                | Query strings stripped from both app and nginx logs                           |
| Cross-site API calls                 | `ALLOWED_ORIGINS` allow-list (set to your real origins, never `*`)            |

## Alternative: Docker

```bash
cd latexdo/collaborations
cp .env.example .env    # if present; otherwise set vars in docker-compose
docker compose up -d --build
docker compose logs -f
```

The compose file publishes on `127.0.0.1:8787`; put your own nginx/Caddy in
front for TLS, or use the native install above (recommended).

## Requirements checklist

- A domain name with an A/AAAA record pointing at the server's public IP.
- Ports 80 and 443 reachable from the internet (for HTTPS + Let's Encrypt).
- Ubuntu/Debian with `apt`. ~1 vCPU / 1 GB RAM handles thousands of concurrent
  editors; scale vertically or run several behind a load balancer with shared
  storage for very large deployments.
