; Windows 安装程序的补充（electron-builder 的 NSIS，desktop/electron-builder.json 的 nsis.include）。
; 第一次装 Electron 版时，旧的 Inno Setup 托盘版（scripts/packages/windows/）还在：先让托盘停掉本机本体、退出，
; 再静默卸掉旧程序，等它卸完再装——两边都装在 %LOCALAPPDATA%\Programs\Plasticine，端口也都是 8790。
; 旧版卸载默认不删数据（%LOCALAPPDATA%\Plasticine\state 留着，Electron 版接着用）。

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
