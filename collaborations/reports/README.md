# LatexDo crash reports on Cloudflare

The server behind the desktop app's "LatexDo crashed. Report it?" prompt
(`https://reports.latexdo.org`). Like the collaboration server
(`../cloudflare`), it runs on Cloudflare's free Workers plan. All reports live
in one SQLite-backed Durable Object (`src/store.ts`), grouped by problem.
`src/index.ts` routes requests and rate-limits them, and `src/report.ts`
validates each report.

## How a report gets here

1. The app records every problem in its local diagnostics log, as before
   (`electron/diagnostics.ts`).
2. **Triage** (`electron/crashReportTriage.ts`) keeps only real bugs: uncaught
   exceptions, React render errors, renderer and GPU crashes, startup failures.
   It drops noise:
   - being offline, a full disk, permission errors, cancelled requests;
   - `ResizeObserver` warnings, Monaco cancellations, thrown strings with no
     stack;
   - errors raised entirely in browser extensions or DevTools;
   - freezes, renderers killed on purpose, clean exits.
3. **Grouping:** each bug gets a fingerprint built from its kind, error name,
   normalized message (numbers, ids, paths and quoted values removed) and top
   stack frames (without line numbers or build hashes). Repeats of a bug add
   to one report's count instead of asking again.
4. **Scrubbing:** before anything is shown or sent, the report loses the home
   folder, user name, project paths and document names, email addresses, API
   keys, share tokens, bearer tokens, and URL paths and queries. Context fields
   are kept only from an allowlist (e.g. `reason`, `exitCode`,
   `componentStack`). LatexDo's own stack frames stay so the bug can be found.
5. **Asking:** the window shows the prompt with **Send report**, **GitHub
   issue** (a pre-filled `latexdo/latexdo-desktop` issue) and dismiss. The
   person can add a note and see the exact JSON first. A crash that closes the
   app stays queued on disk and is offered at the next start.
6. The app asks about a problem once per app version, and about at most five
   new problems per session. Settings → About → _Crash and bug reports_:
   _Ask me each time_ (default), _Send automatically_, or _Never send_.

## API

| Method  | Path                       | Who   | What                                                                                          |
| ------- | -------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `GET`   | `/api/health`              | all   | Health check                                                                                  |
| `POST`  | `/api/reports`             | app   | `{ report, reporter }`. Returns `201 { id, known, occurrences, reporters, status, fixedIn? }` |
| `GET`   | `/api/issues`              | admin | `?status=open\|fixed\|ignored\|regressed&limit=50`                                            |
| `GET`   | `/api/issues/:fingerprint` | admin | One problem and its newest 20 samples                                                         |
| `PATCH` | `/api/issues/:fingerprint` | admin | `{ status?, fixedIn?, githubIssue? }`                                                         |
| `GET`   | `/api/stats`               | admin | `?days=30` (1–365): exact report counts per day, version, platform and category, top problems |

Admin calls send `Authorization: Bearer $ADMIN_TOKEN`. Until that secret is
set, the admin routes return 404. If an issue is marked
`{ "status": "fixed", "fixedIn": "1.4.0" }`, people who report it again are
told that updating fixes it. A report from `1.4.0` or later marks the issue
`regressed`.

## Protections

- **Server-side validation:** strict shape and size limits (64 KB per report),
  a second pass that strips emails, tokens and home folders, and refusal
  (`422 ignored`) of network and system noise.
- **No IP addresses stored, no request logs.** The reporter's random install
  id is stored only as a SHA-256 hash, to count distinct people per problem.
- **Rate limit:** 10 reports per minute per address. Retries of the same
  report id count once.
- **Bounded storage:** 20 samples per problem and 20,000 reports in total.
  Samples are deleted after 180 days, and problems unseen for a year after
  that.
- **No CORS:** only the app's main process posts here.

## Develop, test, deploy

```sh
npm install
npm run typecheck
npm run dev                         # wrangler dev on :8791
REPORTS_URL=http://localhost:8791 npm test   # end-to-end tests
```

Point the app at a local server with
`LATEXDO_REPORTS_URL=http://localhost:8791`. Turn reporting off entirely with
`LATEXDO_CRASH_REPORTS=off`.

Deploy by hand (there is deliberately no deploy workflow):

```sh
npx wrangler login
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

List open problems:

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://reports.latexdo.org/api/issues?status=open
```
