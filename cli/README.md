# latexdo-cli

`latexdo-cli` installs the `latexdo` command. The command keeps a cached copy of the main LatexDo app, installs dependencies when they change, starts the local browser editor, and opens it in the default browser.

The installer verifies the downloaded command against the SHA-256 digest pinned
in `install.sh` before it is made executable. A custom `LATEXDO_CLI_URL` must be
paired with its expected `LATEXDO_CLI_SHA256`.

## Repository Role

- Publishes the `latexdo` command package.
- Provides the shell installer used by `https://latexdo.org/install.sh`.
- Launches the local browser editor from `github.com/latexdo/latexdo`.

## Requirements

- Git.
- Node.js 22.17 or newer.
- npm.
- A browser.
- Optional: a TeX distribution with `latexmk` for local PDF compilation.

## Install

```sh
curl -fsSL https://latexdo.org/install.sh | bash
```

Use a different binary directory:

```sh
LATEXDO_BIN_DIR=/usr/local/bin curl -fsSL https://latexdo.org/install.sh | bash
```

Skip first-run bootstrap:

```sh
LATEXDO_SKIP_BOOTSTRAP=1 curl -fsSL https://latexdo.org/install.sh | bash
```

## Run Locally

Run the CLI from this checkout against the local main app repo:

```sh
LATEXDO_APP_DIR=/Users/omar/Desktop/Personal/latexdo LATEXDO_SKIP_UPDATE=1 ./bin/latexdo
```

Print the URL instead of opening a browser:

```sh
LATEXDO_APP_DIR=/Users/omar/Desktop/Personal/latexdo LATEXDO_SKIP_UPDATE=1 LATEXDO_NO_OPEN=1 ./bin/latexdo
```

Use a custom host or port:

```sh
./bin/latexdo --host 127.0.0.1 --port 5174
```

## Common Commands

```sh
latexdo              # Start the local browser editor.
latexdo update       # Update the cached app and dependencies.
latexdo verify-update # Verify and print the signed release source.
latexdo doctor       # Check local tools.
latexdo path         # Print the cached app path.
latexdo reset        # Remove the cached app checkout.
./bin/latexdo help   # Show local CLI help.
```

## Development

Edit the command in `cli/` of the main repository. The website
(`latexdo.org`) serves `install.sh` and `bin/latexdo` from there; update the
SHA-256 digest pinned in `install.sh` whenever `bin/latexdo` changes.

## Related Repos

- `latexdo` - desktop app, shared editor UI and this command.
- `latexdo.org` - public website, installer endpoint and update metadata.
