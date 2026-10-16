# Contributing to LatexDo

Thank you for helping. Bug reports, ideas and pull requests are all welcome.

## Getting started

```sh
git clone https://github.com/latexdo/latexdo-desktop.git
cd latexdo-desktop
npm install
npm run dev
```

You need Node.js 22 or newer, and a TeX distribution with `latexmk` to compile
documents (MacTeX, MiKTeX or TeX Live).

## Commands

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Run the desktop app in development mode       |
| `npm test`              | Run the tests                                 |
| `npm run test:coverage` | Run the tests with coverage                   |
| `npm run lint`          | Check the code with ESLint                    |
| `npm run typecheck`     | Check TypeScript types                        |
| `npm run format:check`  | Check formatting with Prettier                |
| `npm run build`         | Build the app                                 |
| `npm run dist`          | Build the installers                          |
| `npm run release:check` | Run every check CI runs, before you open a PR |

## Before you open a pull request

Run `npm run format:check`, `npm run lint`, `npm run typecheck` and `npm test`.
Add a test for the change when you can.

## Tests

`npm run test:coverage` measures every JavaScript and TypeScript file under `src/`,
`electron/`, `collaborations/`, `scripts/` and `latexdo/`, including files no test
imports, and fails if a file is missing from the report. It also refreshes the
badge in `docs/coverage.svg`; commit it with your change. The detailed report is in
`coverage/lcov-report/index.html`.

## How releases work

One GitHub Actions workflow, `latexdo-ci`, runs on every push and pull request:

1. Formatting, lint, types, tests, coverage, dependency audit, supply-chain rules
   and the production build.
2. Packaging and smoke tests of the macOS, Windows and Linux installers.
3. On `main`: publishing the GitHub release and updating the downloads and the
   signed update feed on [latexdo.org](https://latexdo.org/downloads/).

Every push to `main` publishes a release, so work on a branch and open a pull
request first.

Secrets used by CI:

- `LATEXDO_WEBSITE_TOKEN` (required): updates latexdo.org.
- `LATEXDO_UPDATE_SIGNING_KEY`: signs the update feed. It must stay the same key, or
  installed apps stop updating.
- macOS signing (optional): `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`,
  `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`.
- Windows signing (optional): `WINDOWS_CERTIFICATE_P12`,
  `WINDOWS_CERTIFICATE_PASSWORD`.

## Sharing a project

Two people with LatexDo can edit the same project live, hosted from the owner's
computer: over the internet through an encrypted Cloudflare quick tunnel, or on the
same network. Builds that set `VITE_LATEXDO_API_BASE_URL` use the self-hosted
server in `collaborations/` instead; see [collaborations/README.md](collaborations/README.md).

## AI catalog

The AI model catalog lives in `catalog/latexdo-ai-catalog.v1.json` and is synced
into generated code by `npm run ai:sync`, which runs before `build` and `typecheck`.
`npm run ai:check` verifies the sync.

## Security

Please report security issues privately as described in [SECURITY.md](SECURITY.md).
