!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering Bokuno-Editor context menu..."
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\windows-shell\register-context-menu.ps1"' $0

  IfErrors 0 +2
    DetailPrint "Failed to start register-context-menu.ps1"

  StrCmp $0 0 +2
    DetailPrint "register-context-menu.ps1 exited with code $0"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Unregistering Bokuno-Editor context menu..."
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\windows-shell\unregister-context-menu.ps1"' $0

  IfErrors 0 +2
    DetailPrint "Failed to start unregister-context-menu.ps1"

  StrCmp $0 0 +2
    DetailPrint "unregister-context-menu.ps1 exited with code $0"
!macroend
