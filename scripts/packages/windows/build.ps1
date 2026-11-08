# 在 Windows 上编出 Plasticine 安装程序（docs/install-packages.md；CI 的 windows-latest 跑这个）：
#   pwsh scripts/packages/windows/build.ps1 -ServerTarball dist\packages\plasticine-server-<版本>.tar.gz `
#     -Out dist\packages
# 1. 解开服务包；2. 下载 Node（按 nodejs.org 的 SHASUMS256.txt 核对）；3. 用系统自带的 csc 编托盘；
# 4. Inno Setup 编安装程序（没装就用 choco 装）。最后打印 { file, name, sha256, size, version }。
param(
  [Parameter(Mandatory = $true)][string]$ServerTarball,
  [Parameter(Mandatory = $true)][string]$Out,
  # 和 scripts/packages/release-manifest.ts 的 PACKAGE_NODE_VERSION 一致（测试核对）。
  [string]$NodeVersion = "24.22.1",
  [string]$NodeMirror = "https://nodejs.org/dist"
)
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stage = Join-Path ([System.IO.Path]::GetTempPath()) ("plasticine-win-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Stage, (Join-Path $Stage "server"), (Join-Path $Stage "node") | Out-Null
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path

try {
  Write-Host "解开服务包"
  # 用系统的 bsdtar：PATH 里可能先排着 Git 带的 GNU tar，它会把 C: 当成远程主机。
  $Tar = Join-Path $env:WINDIR "System32\tar.exe"
  & $Tar -xzf $ServerTarball -C (Join-Path $Stage "server") --strip-components=1
  if ($LASTEXITCODE -ne 0) { throw "服务包解不开：$ServerTarball" }
  $Manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $Stage "server\manifest.json") | ConvertFrom-Json
  $Version = $Manifest.version

  Write-Host "下载 Node $NodeVersion"
  $NodeName = "node-v$NodeVersion-win-x64"
  $Zip = Join-Path $Stage "$NodeName.zip"
  $Sums = Join-Path $Stage "SHASUMS256.txt"
  Invoke-WebRequest -UseBasicParsing -Uri "$NodeMirror/v$NodeVersion/$NodeName.zip" -OutFile $Zip
  Invoke-WebRequest -UseBasicParsing -Uri "$NodeMirror/v$NodeVersion/SHASUMS256.txt" -OutFile $Sums
  $Want = (Select-String -Path $Sums -Pattern " $NodeName.zip$").Line.Split(" ")[0]
  $Have = (Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLowerInvariant()
  if (-not $Want -or $Want -ne $Have) { throw "Node 安装包的 SHA-256 对不上" }
  Expand-Archive -Path $Zip -DestinationPath $Stage
  Copy-Item (Join-Path $Stage "$NodeName\node.exe") (Join-Path $Stage "node\node.exe")
  Copy-Item (Join-Path $Stage "$NodeName\LICENSE") (Join-Path $Stage "node\LICENSE")

  Write-Host "生成应用图标"
  $Icon = Join-Path $Stage "Plasticine.ico"
  & (Join-Path $Here "make-icon.ps1") -Source (Join-Path $Stage "server\client\dist\icon-512.png") -Destination $Icon

  Write-Host "编托盘"
  $Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  $Sources = Get-ChildItem (Join-Path $Here "tray\*.cs") | ForEach-Object { $_.FullName }
  & $Csc /nologo /target:winexe /optimize+ "/out:$(Join-Path $Stage 'PlasticineTray.exe')" `
    "/win32icon:$Icon" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll @Sources
  if ($LASTEXITCODE -ne 0) { throw "托盘没编过" }

  Write-Host "编安装程序"
  $Iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
  if (-not (Test-Path $Iscc)) {
    choco install innosetup --no-progress -y | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "装不上 Inno Setup" }
  }
  & $Iscc /Q "/DAppVersion=$Version" "/DStage=$Stage" "/O$Out" (Join-Path $Here "plasticine.iss")
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup 没编过" }

  $Setup = Join-Path $Out "Plasticine-Setup-$Version.exe"
  $Result = [ordered]@{
    file = $Setup
    name = Split-Path -Leaf $Setup
    sha256 = (Get-FileHash -Algorithm SHA256 $Setup).Hash.ToLowerInvariant()
    size = (Get-Item $Setup).Length
    version = $Version
  }
  $Result | ConvertTo-Json -Compress
} finally {
  Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
}
