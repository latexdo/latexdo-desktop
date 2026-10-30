# Release notes

Users see **Help → What's New** at any time. After a detected update, the same window opens once for that build. The installer includes these summaries, so reading them does not require internet access.

Before publishing an update:

1. Edit the JSON file matching `package.json`'s version. Describe visible features in `highlights`, corrections in `fixes`, and any migration requirements in `breakingChanges`.
2. Update `publishedAt` in both that document and `index.json`. For a new version, add a new document and a corresponding index entry; keep older entries for users who skip versions.
3. Run `npm run build`. A missing document for the package version fails the build. The summaries are copied into `dist-electron/release-notes` and packaged with the app.

For another build of the same version, update its existing summary. Commit messages starting with `feat:`, `fix:`, or `perf:` also populate the “In this update” list when the previous build is present in the bundled Git history. Use short, user-facing descriptions.

The publication workflow uses the same JSON to write the GitHub release description. It separately signs and uploads the website copies when `LATEXDO_UPDATE_SIGNING_KEY` is configured. Remote notes still require signature verification; bundled notes come from the installed application. Publishing this change is required before existing users receive offline notes.
