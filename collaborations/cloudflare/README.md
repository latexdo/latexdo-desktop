# LatexDo collaborations on Cloudflare

The always-on server behind internet sharing (`https://collab.latexdo.org`).
Each shared project is one SQLite-backed Durable Object (`src/room.ts`), so a
project stays online when its owner closes the app, goes offline or changes
address. `src/index.ts` routes requests, rate-limits them and keeps each
owner's project list; `src/usage.ts` meters storage.

## End-to-end encryption

The server stores and relays **ciphertext only**. Each project has a random
256-bit key, made on the owner's computer, kept in the OS keychain
(`electron/collabKeys.ts`) and carried only inside the invite, which people
paste into the app. The server never receives it.

- Text files are logs of Yjs updates sealed with AES-256-GCM (fresh nonce per
  message), merged by each app (`electron/cloudE2ee.ts`). Figures, PDFs and
  other files are sealed blobs. Live edits, cursors, the project's name and
  people's names are sealed too.
- Every ciphertext is bound to its project and kind, so the server cannot move
  data between projects or pass a cursor off as an edit; tampering is detected.
- What the server can see: file paths, sizes, timestamps, roles and opaque ids.
  It needs them to manage the file tree and enforce access.
- Anyone holding a valid invite has the key. A removed person is cut off by the
  server (they no longer receive any data), and approval is on by default, so a
  leaked invite alone does not let anyone in.

## Co-author web editor

Co-authors who do not have LatexDo open the project's web link,
`https://collab.latexdo.org/join#<invite>`, and edit in their browser with no
account or install. The page (`web/guest` in the desktop repository) is built
into `public/` and served by this Worker, so it calls the API from the same
origin and the server still sends no CORS headers.

- It speaks the same encrypted protocol as the desktop app. The key is in the
  part of the link after `#`, which browsers never send to a server.
- Approval, roles and removal work as for desktop users; viewers read only.
- Text files are edited live with cursors; figures and PDFs are decrypted for
  viewing. Compiling stays in the desktop app.
- A strict Content Security Policy (`web/guest/public/_headers`) allows only
  this origin's scripts and connections, and no framing.

## Protections against abuse

- **No access from other websites:** no CORS, so pages elsewhere cannot call
  the server; only the app and the web editor on this origin can.
- **No request logs:** URLs carry share tokens and session ids, so
  observability logging is off.
- **Rate limits** per address across Cloudflare's network: 600 requests and 5
  new projects per minute.
- **Caps:** 100 MB and 2,000 files per project, 25 MB per file, 20 projects per
  owner, 150 open documents per project, 40 per computer.
- **Storage guard:** the meter refuses uploads and new projects once all
  projects together reach 4 GB of the free plan's 5 GB.
- **Cleanup:** a project nobody opens for a year is deleted.
- **Roles enforced on the server:** viewers cannot write; removing someone
  retires their access; stopping sharing locks everyone but the owner out.
- Sessions are stored only as SHA-256 hashes; tokens are 256-bit random.

## Free plan

Everything runs on Cloudflare's free Workers plan (SQLite-backed Durable
Objects and the rate-limiting binding; no R2, no KV). Per account and per day:
100,000 requests (incoming WebSocket messages count 1/20), 13,000 GB-s,
100,000 rows written, 5 GB stored. Edits are sent in quarter-second batches and
saved every 4 seconds while someone types. Going over never costs money:
requests fail until 00:00 UTC and editors keep working offline.

## Develop, test, deploy

```sh
npm install
npm run typecheck
npm run dev                       # builds the web editor, then wrangler dev on :8790
npm test                          # end-to-end tests (COLLAB_URL=… to target another server)
```

The desktop app's real-bridge test runs against a server too:

```sh
# from the repository root
LATEXDO_E2E_CLOUD=1 LATEXDO_COLLAB_URL=http://127.0.0.1:8790 \
  npx vitest run electron/peerCollab.integration.test.ts web/guest
```

Deploy by hand (there is deliberately no deploy workflow):

```sh
npx wrangler login
npm run deploy
```

Point the app elsewhere with `LATEXDO_COLLAB_URL`. Projects shared before
encryption (server version 2) cannot be opened; share them again.
