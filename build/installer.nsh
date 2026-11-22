; Included automatically by electron-builder (build/installer.nsh).

; When the previous version's uninstaller fails during an upgrade, electron-builder's
; default check shows "uninstall failed" in a message box with no silent default. NSIS
; shows such boxes even under /S, so a silent update (--updated /S, run by the update
; helper) waits forever on a dialog nobody may see. Keep the same check and message,
; but let silent runs exit with code 2 so the helper can retry or report the failure.
!macro latexdoUninstallCheck
  ${if} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  ${elseif} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
!macroend

!macro customUnInstallCheck
  !insertmacro latexdoUninstallCheck
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro latexdoUninstallCheck
!macroend
