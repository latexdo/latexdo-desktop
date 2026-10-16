// electron-builder afterPack hook. On Linux the Electron binary is replaced by
// a small launcher that starts the real binary, adding --no-sandbox only when
// this computer cannot run Chromium's sandbox. Without it the app aborts at
// startup on desktops that restrict unprivileged user namespaces (the Ubuntu
// 24.04+ default), where the AppImage's own `unshare` probe can still succeed.
/* eslint-disable @typescript-eslint/no-require-imports */
const { chmod, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");

function linuxLauncherScript(executableName, procRoot = "/proc") {
  return `#!/bin/sh
here="$(dirname "$(readlink -f "$0")")"
bin="$here/${executableName}.bin"

for arg in "$@"; do
  if [ "$arg" = "--no-sandbox" ]; then
    exec "$bin" "$@"
  fi
done

flag() {
  cat "${procRoot}/sys/$1" 2>/dev/null
}

sandbox=1
[ "$(flag kernel/apparmor_restrict_unprivileged_userns)" = "1" ] && sandbox=0
[ "$(flag kernel/unprivileged_userns_clone)" = "0" ] && sandbox=0
[ "$(flag user/max_user_namespaces)" = "0" ] && sandbox=0

# A root-owned setuid helper keeps the sandbox working without user namespaces.
if [ -u "$here/chrome-sandbox" ] && [ "$(stat -c %u "$here/chrome-sandbox" 2>/dev/null)" = "0" ]; then
  sandbox=1
fi

if [ "$sandbox" = "0" ]; then
  exec "$bin" --no-sandbox "$@"
fi
exec "$bin" "$@"
`;
}

async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;
  const executableName = context.packager.executableName;
  const executable = path.join(context.appOutDir, executableName);
  await rename(executable, `${executable}.bin`);
  await writeFile(executable, linuxLauncherScript(executableName));
  await chmod(executable, 0o755);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.linuxLauncherScript = linuxLauncherScript;
