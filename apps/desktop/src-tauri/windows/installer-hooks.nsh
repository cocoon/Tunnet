; Post-install: register the Tunnet Windows service when binaries are present.
; Copy wintun.dll next to tunnetd if bundled under resources.
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\resources\wintun.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\wintun.dll" "$INSTDIR\wintun.dll"
  IfFileExists "$INSTDIR\wintun.dll" 0 +2
    DetailPrint "wintun.dll installed"
  IfFileExists "$INSTDIR\tunnet.exe" 0 +3
    nsExec::ExecToLog '"$INSTDIR\tunnet.exe" service install'
    nsExec::ExecToLog '"$INSTDIR\tunnet.exe" service start'
!macroend
