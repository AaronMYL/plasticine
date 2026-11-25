!macro customInit
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\Plasticine\PlasticineTray.exe"
    ExecWait '"$LOCALAPPDATA\Programs\Plasticine\PlasticineTray.exe" --quit'
  ${EndIf}
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\Plasticine\unins000.exe"
    ExecWait '"$LOCALAPPDATA\Programs\Plasticine\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART'
    StrCpy $R1 0
    ${DoWhile} ${FileExists} "$LOCALAPPDATA\Programs\Plasticine\unins000.exe"
      Sleep 500
      IntOp $R1 $R1 + 1
      ${If} $R1 > 60
        ${ExitDo}
      ${EndIf}
    ${Loop}
  ${EndIf}
!macroend
