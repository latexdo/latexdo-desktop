/*
 * Full-window notice shown while LatexDo counts down to quitting for an
 * update install (#265): "5, 4, 3, 2, 1" and a reminder to save. The main
 * process drives the count through update progress events; unsaved tabs are
 * still saved by the normal close path when the count reaches zero.
 */

import React from "react";
import { RefreshCw } from "lucide-react";

export function UpdateRestartCountdown() {
  const [state, setState] = React.useState<{
    seconds: number;
    version: string | null;
  } | null>(null);

  React.useEffect(
    () =>
      window.latexdo.onUpdateProgress((progress) => {
        if (typeof progress.restartInSeconds === "number") {
          setState({
            seconds: progress.restartInSeconds,
            version: progress.latestVersion,
          });
        } else if (progress.status === "error" || progress.status === "failed") {
          setState(null);
        }
      }),
    [],
  );

  if (!state) return null;
  return (
    <div className="update-restart-backdrop">
      <div
        className="update-restart-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-restart-title"
        aria-describedby="update-restart-body"
      >
        <RefreshCw size={22} className="update-restart-icon" aria-hidden="true" />
        <h2 id="update-restart-title">
          {state.version ? `Updating to LatexDo ${state.version}` : "Updating LatexDo"}
        </h2>
        <div className="update-restart-count" aria-live="assertive" aria-atomic="true">
          {state.seconds}
        </div>
        <p id="update-restart-body">
          {`LatexDo will restart in ${state.seconds} second${state.seconds === 1 ? "" : "s"}. `}
          Save your work — open documents with unsaved changes are saved before LatexDo
          closes.
        </p>
      </div>
    </div>
  );
}
