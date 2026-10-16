# latexdo

[![JS/TS line coverage](docs/coverage.svg)](#test-coverage)

LatexDo is a desktop LaTeX editor built with Electron, React, TypeScript,
Monaco, Vite, and local LaTeX tooling.

## Run

```sh
npm install
npm run dev
```

## Workspace tabs and AI

The Knowledge button opens the bibliography graph as an editor tab. Drag tabs to
reorder them, or focus a tab and press Alt+Shift+Left/Right. Closing the graph
returns to your document without discarding its unsaved changes.

In AI chat, use **Work with tab** to follow the active tab or pin a particular
file or the Knowledge Graph. A request keeps its target while you browse other
tabs. With the graph selected, ask “Show only entries related to my paper” to
filter the visible bibliography. Matching uses citations and bibliography metadata
against the root paper and its included sources, including unsaved text. It does
not verify scientific support or edit `.bib` files. **Show all entries** resets
the view. Graph tools require Current editor and Bibliography access; matching
against the paper also requires Project files access in AI settings.

## Sharing a project (no server needed)

Two or more people who have LatexDo installed can edit the same project live.
One of them hosts the project from their own computer; nobody rents or runs a
server.

1. The owner opens a project, clicks **Share**, picks how to share and presses
   **Start sharing**.
   - **Over the internet** works from anywhere. LatexDo opens a free, encrypted
     Cloudflare quick tunnel to this computer. The first use downloads the
     `cloudflared` helper (checksum-pinned in `electron/peerTunnel.ts`).
   - **Same network only** needs no internet, but the traffic is not encrypted,
     so use it on a network you trust.
2. The owner copies the invite and sends it to collaborators.
3. A collaborator clicks **Share**, pastes the invite under **Join** and presses
   **Join**. Each person compiles the PDF on their own computer.

The project stays available while LatexDo is open on the owner's computer. The
owner can require approval for newcomers, change roles (admin, editor, viewer),
remove people (which also retires the invite they hold), issue a new invite and
stop sharing. Collaborators edit a shared copy; **Save to my folder** or **Stop
sharing** writes it back to the owner's folder. Only text files are shared, so
figures and other binary files are not sent to collaborators.

Builds that set `VITE_LATEXDO_API_BASE_URL`, and the pro edition, keep using the
self-hosted server in `collaborations/` instead.

## LaTeX Toolchain

Desktop PDF compilation uses the TeX tools installed on the user's machine.
Install a full TeX distribution before pressing **Compile**:

- macOS: MacTeX
- Windows: MiKTeX or TeX Live
- Linux: TeX Live, including `latexmk`

If compilation fails immediately, first check that `latexmk` is available from
the terminal. Partial TeX installs can also fail when a document needs packages
such as `booktabs`, `microtype`, or `hyperref`.

## Commands

```sh
npm run build             # Build web and Electron output.
npm run typecheck         # Run TypeScript checks.
npm run lint              # Run ESLint.
npm test                  # Run Vitest.
npm run test:coverage     # Run tests with coverage.
npm run package           # Build an unpacked desktop app.
npm run dist              # Build distributable installers.
npm run release:check     # Run the local release-readiness gate.
npm run ai:check          # Validate AI catalog/source sync.
```

## Test Coverage

`npm run test:coverage` measures all JavaScript and TypeScript source under
`src/`, `electron/`, `collaborations/`, `scripts/`, and `latexdo/`, including
files that no test imports. This includes the application entry points, Monaco
integration, every feature, Electron preload and backend, collaboration server,
generated runtime code, and development/release tooling.

Tests, test harnesses, type declarations, dependencies, and compiled build output
are excluded. Shell scripts, CSS, HTML, and other
non-JavaScript assets cannot be instrumented by V8 and are not part of this
percentage. Code executed only in a separate process is included as uncovered
unless its coverage is collected; this report does not merge subprocess coverage.

The badge is a snapshot of the last successful full coverage run and refreshes
automatically when `npm run test:coverage` succeeds. Commit `docs/coverage.svg`
alongside test changes to keep the README current. Detailed results are written to
`coverage/lcov-report/index.html`, `coverage/lcov.info`, and
`coverage/coverage-summary.json`.

The coverage command also verifies that every eligible source file appears in the
report, failing if a transformation error silently drops one.

The full-codebase coverage gate requires 43% lines, 42% statements, 45% functions,
and 38% branches. The previously measured subset retains its existing thresholds
of 79% lines, 78% statements, 82% functions, and 66% branches.

## CI And Release

There is one GitHub Actions workflow: `latexdo-ci`.

It does three things:

1. Checks formatting, lint, types, tests, coverage, audit, supply-chain rules,
   and production build.
2. Packages and smoke-tests macOS, Windows, and Linux installers.
3. On `main`, version tags, or manual runs on `main`, publishes release assets
   and updates only `downloads/` plus optional signed `updates/` in
   `latexdo/latexdo.org`.

Release downloads live at:

- `https://www.latexdo.org/downloads/`
- `https://www.latexdo.org/updates/latest.json`

Required publication secret:

- `LATEXDO_WEBSITE_TOKEN`

Optional release secrets:

- macOS signing/notarization:
  `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8`,
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`
- Windows signing:
  `WINDOWS_CERTIFICATE_P12`, `WINDOWS_CERTIFICATE_PASSWORD`
- signed update feed:
  `LATEXDO_UPDATE_SIGNING_KEY`

## AI Source

AI catalog/source files are kept in this repo and synced into generated code by
`npm run ai:sync`, which also runs before build and typecheck. The public catalog
is `catalog/latexdo-ai-catalog.v1.json`.
