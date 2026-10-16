# Issue #242: taskbar icon audit

Issue: https://github.com/latexdo/latexdo/issues/242

Status: needs clarification; no icon defect has been reproduced.

The issue has no screenshot or description identifying the platform or icon.
The existing implementation uses `build/icon.png` (the blue LatexDo document
mark) for Electron windows and explicitly calls `app.dock.setIcon` on macOS.
The packaging configuration also specifies that asset. The asset was inspected,
and the production browser preview displays the matching LatexDo titlebar mark.

Please identify whether the report concerns the macOS Dock, Windows taskbar,
or an in-app toolbar button, and whether it occurs in an installed release or a
development run. Native packaged-app icon behavior has not been verified here.
Do not mark this issue fixed on the strength of configuration inspection alone.
