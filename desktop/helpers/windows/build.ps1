# 编 Windows 系统助手（desktop/helpers/windows/*.cs → PlasticineHelper.exe），用每台 Windows 自带的 .NET Framework 4.x
# 和 csc（和托盘 scripts/packages/windows/build.ps1 同一个做法，不加依赖）。
#   pwsh desktop/helpers/windows/build.ps1 -Out desktop/resources-dev/helper
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$Sources = Get-ChildItem (Join-Path $Here "*.cs") | ForEach-Object { $_.FullName }
& $Csc /nologo /target:exe /optimize+ "/out:$(Join-Path $Out 'PlasticineHelper.exe')" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll @Sources
if ($LASTEXITCODE -ne 0) { throw "助手没编过" }
Write-Host "编好了：$(Join-Path $Out 'PlasticineHelper.exe')"
