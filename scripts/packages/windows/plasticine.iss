; Plasticine 的 Windows 安装程序（Inno Setup 6，docs/install-packages.md）。不签名：SmartScreen 会提示，选「仍要运行」。
; 由 build.ps1 编译：ISCC /DAppVersion=<版本> /DStage=<准备好的目录> plasticine.iss
;   Stage\node\node.exe       Node 运行时
;   Stage\server\...          服务包（scripts/packages/build-server.ts 的 tar.gz 解开）
;   Stage\PlasticineTray.exe  托盘（tray\*.cs）
; 只为当前用户安装，不要管理员：程序在 %LOCALAPPDATA%\Programs\Plasticine，数据在 %LOCALAPPDATA%\Plasticine。
; 每次安装把安装程序自己留一份在 %LOCALAPPDATA%\Plasticine\installers，托盘的「回到上一版」运行上一份。

#ifndef AppVersion
  #error 要用 /DAppVersion=<版本> 编译
#endif
#ifndef Stage
  #error 要用 /DStage=<准备好的目录> 编译
#endif

[Setup]
AppId={{6F1C3B52-8A0E-4C57-9B7D-2E5A9C4F1D30}
AppName=Plasticine
AppVersion={#AppVersion}
AppVerName=Plasticine {#AppVersion}
AppPublisher=Plasticine
DefaultDirName={localappdata}\Programs\Plasticine
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=Plasticine-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#Stage}\Plasticine.ico
UninstallDisplayIcon={app}\PlasticineTray.exe
UninstallDisplayName=Plasticine
; 托盘由下面的 PrepareToInstall 让它自己退出；不用重启管理器去关它。
CloseApplications=no
SetupLogging=yes

[Languages]
#if FileExists(AddBackslash(CompilerPath) + "Languages\ChineseSimplified.isl")
Name: "zh"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
#elif FileExists(AddBackslash(CompilerPath) + "Languages\Unofficial\ChineseSimplified.isl")
Name: "zh"; MessagesFile: "compiler:Languages\Unofficial\ChineseSimplified.isl"
#else
Name: "en"; MessagesFile: "compiler:Default.isl"
#endif

[InstallDelete]
; 新版服务整份换上，旧文件不留（不然删掉的源码还会被 import 到）。
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\node"

[Files]
Source: "{#Stage}\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\PlasticineTray.exe"; DestDir: "{app}"; Flags: ignoreversion
; 安装程序自己留一份，回退用；在数据目录里，卸载程序不删它（问了才连数据一起删）。
Source: "{srcexe}"; DestDir: "{localappdata}\Plasticine\installers"; DestName: "Plasticine-Setup-{#AppVersion}.exe"; Flags: external ignoreversion uninsneveruninstall

[Icons]
Name: "{userprograms}\Plasticine"; Filename: "{app}\PlasticineTray.exe"; Parameters: "--open"

[Run]
; 交互安装：完成页勾着「打开 Plasticine」。静默安装（自更新、回退、CI 冒烟）：只把托盘和服务起来。
Filename: "{app}\PlasticineTray.exe"; Parameters: "--open"; Description: "打开 Plasticine"; Flags: postinstall nowait skipifsilent
Filename: "{app}\PlasticineTray.exe"; Parameters: "--background"; Flags: nowait skipifnotsilent

[UninstallRun]
Filename: "{app}\PlasticineTray.exe"; Parameters: "--quit"; Flags: runhidden waituntilterminated; RunOnceId: "StopPlasticine"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';

// 装之前让正在跑的托盘停服务、退出，程序文件才换得掉。
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Tray: String;
  Code: Integer;
begin
  Result := '';
  Tray := ExpandConstant('{app}\PlasticineTray.exe');
  if FileExists(Tray) then
    Exec(Tray, '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

// 卸载完问一句要不要连数据一起删；默认「否」（静默卸载也是否）。命令行 /DELETEDATA=1 直接删（CI 冒烟用）。
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep <> usPostUninstall then
    Exit;
  RegDeleteValue(HKEY_CURRENT_USER, RunKey, 'Plasticine');
  Data := ExpandConstant('{localappdata}\Plasticine');
  if not DirExists(Data) then
    Exit;
  if (ExpandConstant('{param:DELETEDATA|0}') = '1') or
     (SuppressibleMsgBox('要把 Plasticine 的数据（对话、笔记、设置）也删掉吗？' + #13#10 + #13#10 +
       '数据在 ' + Data + #13#10 + '选「否」会留着，以后重装接着用。',
       mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES) then
    DelTree(Data, True, True, True);
end;
