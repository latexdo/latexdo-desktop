# LatexDo Collaboration Server

This directory contains the self-hosted backend for LatexDo collaboration. It is
designed to run on a normal server and connect multiple LatexDo users to the same
shared project.

The server handles:

- project creation and project file storage
- local-project upload from the desktop app
- share tokens and collaborator roles
- collaborator presence
- real-time Yjs document synchronization over WebSocket
- file list/read/write/create/move APIs
- project download by each desktop client for local compilation

The server does not compile LaTeX, run Git, run terminals, or execute user code.
Compilation stays on each user's machine. When a user compiles a shared project,
the desktop app downloads the shared source files from this server into a local
scratch directory and runs the local TeX toolchain.

## Runtime Model

1. User A opens a local LatexDo project.
2. User A clicks share. The desktop app creates a project on this server and
   uploads text files.
3. The server returns a share token.
4. User B opens LatexDo and joins with the token.
5. Both users connect to `/api/projects/:id/files/collaborate` through
   WebSocket for the active file.
6. Yjs updates go through the server and are persisted to disk.
7. Each user's PDF compilation remains local to that user's computer.

## Files

- `server.mjs`: Node HTTP/WebSocket server.
- `.env.example`: production environment template.
- `systemd/latexdo-collaborations.service`: Linux service unit.
- `nginx/latexdo-collaborations.conf`: reverse-proxy template with WebSocket
  upgrade support.
- `Dockerfile` and `docker-compose.yml`: containerized deployment option.

## API Contract

The server implements the routes already used by `src/cloudApi.ts`,
`electron/preload.cts`, and `src/collaboration/collaborationApi.ts`:

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects`
- `POST /api/projects/open`
- `GET /api/projects/:projectId/files`
- `POST /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content?path=...`
- `PUT /api/projects/:projectId/files/content?path=...`
- `GET /api/projects/:projectId/files/exists?path=...`
- `POST /api/projects/:projectId/files/move`
- `GET /api/projects/:projectId/share`
- `POST /api/projects/:projectId/share`
- `POST /api/shares/:token/open`
- `POST /api/shares/:token/presence`
- `GET /api/shares/:token/permissions`
- `PUT /api/shares/:token/permissions`
- `DELETE /api/shares/:token/collaborators/:clientId` (also retires the invite)
- `DELETE /api/projects/:projectId/share` (stop sharing)
- `PUT /api/shares/:token/approval` (require approval for newcomers)
- `POST /api/shares/:token/pending/:clientId` (approve or deny a join request)
- `WebSocket /api/projects/:projectId/files/collaborate?path=...`

`/api/import/docx` and `/api/import/markdown` deliberately return `501` unless
you add a converter. This server does not include document conversion or LaTeX
compilation.

## Environment

Copy the template and edit it:

```sh
cp collaborations/.env.example /etc/latexdo/collaborations.env
```

Important values:

- `LATEXDO_COLLAB_HOST`: bind address. Use `127.0.0.1` behind Nginx.
- `LATEXDO_COLLAB_PORT`: backend port, default `8787`.
- `LATEXDO_COLLAB_DATA_DIR`: persistent project storage.
- `LATEXDO_COLLAB_PUBLIC_ORIGIN`: HTTPS origin exposed to users.
- `LATEXDO_COLLAB_SHARE_URL_BASE`: optional page that opens share links. Leave
  it empty and people share the invite token, which LatexDo accepts directly.
- `LATEXDO_COLLAB_ALLOWED_ORIGINS`: comma-separated browser origins allowed by
  CORS, for example `latexdo://app` and any local test origins.
- `LATEXDO_COLLAB_CREATE_KEY`: when set, creating or listing projects requires
  the same value in the `x-latexdo-host-key` header. The desktop app sets it
  when it hosts this server on a user's own computer, so guests cannot create
  projects there. Leave it unset on a shared server.

## Local Run

From the repo root:

```sh
npm ci
npm run collab:start
```

Health check:

```sh
curl http://127.0.0.1:8787/api/health
```

For local testing:

```sh
VITE_LATEXDO_API_BASE_URL=http://127.0.0.1:8787 npm run dev
```

## Linux Server Setup

Example paths:

- repo checkout: `/opt/latexdo`
- data directory: `/var/lib/latexdo-collaborations`
- env file: `/etc/latexdo/collaborations.env`

Install Node.js 22.17 or newer, then:

```sh
sudo useradd --system --home /var/lib/latexdo-collaborations --shell /usr/sbin/nologin latexdo
sudo mkdir -p /opt /etc/latexdo /var/lib/latexdo-collaborations /var/log/latexdo-collaborations
sudo chown -R latexdo:latexdo /var/lib/latexdo-collaborations /var/log/latexdo-collaborations
sudo git clone https://github.com/latexdo/latexdo-desktop.git /opt/latexdo
cd /opt/latexdo
sudo npm ci --omit=dev
sudo cp collaborations/.env.example /etc/latexdo/collaborations.env
sudo cp collaborations/systemd/latexdo-collaborations.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now latexdo-collaborations
```

Check it:

```sh
systemctl status latexdo-collaborations
journalctl -u latexdo-collaborations -f
curl http://127.0.0.1:8787/api/health
```

## Nginx Reverse Proxy

Copy the template and set `server_name`:

```sh
sudo cp collaborations/nginx/latexdo-collaborations.conf /etc/nginx/sites-available/latexdo-collaborations
sudo ln -s /etc/nginx/sites-available/latexdo-collaborations /etc/nginx/sites-enabled/latexdo-collaborations
sudo nginx -t
sudo systemctl reload nginx
```

The proxy must preserve WebSocket upgrades:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
proxy_buffering off;
```

Put TLS in front of this vhost with your normal certificate tooling. Clients
should use the HTTPS origin, for example:

```text
https://collaborations.example.com
```

## Docker Compose

```sh
cd collaborations
cp .env.example .env
docker compose up -d --build
```

The compose file binds the backend to `127.0.0.1:8787`; keep Nginx or another
TLS reverse proxy in front of it.

## Connecting LatexDo Clients

Desktop development:

```sh
VITE_LATEXDO_API_BASE_URL=https://collaborations.example.com npm run dev
```

Packaged desktop builds read the same environment variable when launched. If you
need a fixed production backend, build/release with the desired
`VITE_LATEXDO_API_BASE_URL`.

## Security Notes

- Run behind HTTPS.
- Keep `LATEXDO_COLLAB_ALLOWED_ORIGINS` tight in production.
- Back up `LATEXDO_COLLAB_DATA_DIR`.
- Do not expose the backend data directory over the web.
- Share tokens are bearer capabilities; anyone with a token can join unless an
  admin removes or demotes them, or approval for newcomers is turned on.

- Rotating a token, or removing a collaborator, retires the old token: it admits
  nobody new, while people who already joined stay signed in.
- Admins can change collaborator roles. Viewers are blocked from HTTP writes and
  from WebSocket document update frames.
- The server rejects path traversal, large files, oversized JSON bodies, and
  oversized WebSocket frames.

## Operational Checks

Minimum checks after deployment:

```sh
curl https://collaborations.example.com/api/health
```

Then from two separate LatexDo clients:

1. Launch both clients with the same `VITE_LATEXDO_API_BASE_URL`.
2. Create or open a local project in client A.
3. Share it and copy the token or share link.
4. Join from client B.
5. Edit one `.tex` file in A and confirm B receives the change.
6. Edit in B and confirm A receives the change.
7. Compile on A and B separately. Both compilations should use each user's local
   TeX installation, not the server.

## Data Layout

The data directory stores:

```text
shares.json
projects/
  project_<id>/
    project.json
    files/
      main.tex
      ...
```

`project.json` stores metadata, share token, roles, and presence. `files/`
stores the shared project source files.
