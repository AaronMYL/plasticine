# 编 Windows 系统助手（desktop/helpers/windows/*.cs → PlasticineHelper.exe），用每台 Windows 自带的 .NET Framework 4.x
# 和 csc（不加依赖）。
#   pwsh desktop/helpers/windows/build.ps1 -Out desktop/resources-dev/helper
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Framework = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
$Csc = Join-Path $Framework "csc.exe"
$Sources = Get-ChildItem (Join-Path $Here "*.cs") | ForEach-Object { $_.FullName }
# UI Automation（读应用的界面、按编号操作）在 .NET Framework 的 WPF 目录里，同样每台 Windows 都有。
$Exe = Join-Path $Out 'PlasticineHelper.exe'
& $Csc /nologo /target:exe /optimize+ "/out:$Exe" "/lib:$(Join-Path $Framework 'WPF')" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll `
  /r:UIAutomationClient.dll /r:UIAutomationTypes.dll /r:WindowsBase.dll @Sources
if ($LASTEXITCODE -ne 0) { throw "助手没编过" }
Write-Host "编好了：$(Join-Path $Out 'PlasticineHelper.exe')"
