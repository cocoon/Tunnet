; Post-install: stage service binaries into %ProgramData%\tunnet\bin and register SCM.
; Desktop (Tunnet.exe) stays in $INSTDIR; the active daemon always runs from ProgramData.
; `tunnet service install` stages tunnet.exe / tunnetd.exe / wintun.dll via stage_daemon_exe.
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\resources\wintun.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\wintun.dll" "$INSTDIR\wintun.dll"
  IfFileExists "$INSTDIR\wintun.dll" 0 +2
    DetailPrint "wintun.dll ready beside install dir (will stage to ProgramData on service install)"
  IfFileExists "$INSTDIR\tunnet.exe" 0 +3
    nsExec::ExecToLog '"$INSTDIR\tunnet.exe" service install'
    nsExec::ExecToLog '"$INSTDIR\tunnet.exe" service start'
!macroend
