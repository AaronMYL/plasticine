# Windows 助手的冒烟（CI 的 windows-latest 跑）：拉起 PlasticineHelper.exe，照协议发几条，核对回执。
#   pwsh desktop/helpers/windows/smoke.ps1 -Helper <PlasticineHelper.exe>
param([Parameter(Mandatory = $true)][string]$Helper)
$ErrorActionPreference = "Stop"
$Work = Join-Path ([System.IO.Path]::GetTempPath()) ("plasticine-helper-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$Info = New-Object System.Diagnostics.ProcessStartInfo $Helper
$Info.UseShellExecute = $false
$Info.RedirectStandardInput = $true
$Info.RedirectStandardOutput = $true
$Info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding $false
$Process = [System.Diagnostics.Process]::Start($Info)
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Writer = New-Object System.IO.StreamWriter($Process.StandardInput.BaseStream, $Utf8)
$Writer.AutoFlush = $true
function Ask($Id, $Method, $Params) {
  $Writer.Write((@{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 5) + "`n")
  $Line = $Process.StandardOutput.ReadLine()
  $Reply = $Line | ConvertFrom-Json
  if ($Reply.id -ne $Id) { throw "回执 id 对不上：$Line" }
  return $Reply
}
try {
  $Reply = Ask "h1" "helper.info" @{}
  if ($Reply.result.methods -notcontains "command.run") { throw "helper.info 没报 command.run" }
  $Reply = Ask "h2" "helper.configure" @{ roots = @($Work) }
  $File = Join-Path $Work "中文.txt"
  $Reply = Ask "h3" "files.write" @{ path = $File; content = "你好"; baseVersion = $null }
  if ($Reply.result.version.Length -ne 64) { throw "files.write 没回版本：$($Reply | ConvertTo-Json -Compress)" }
  $Reply = Ask "h4" "files.read" @{ path = $File }
  if ($Reply.result.content -ne "你好") { throw "files.read 读回不对" }
  $Reply = Ask "h5" "files.read" @{ path = "C:\Windows\win.ini" }
  if ($Reply.error.code -ne "refused") { throw "授权目录外没拒" }
  $Reply = Ask "h6" "command.run" @{ command = "echo hi"; cwd = $Work }
  if ($Reply.result.stdout.Trim() -ne "hi") { throw "command.run 输出不对：$($Reply | ConvertTo-Json -Compress)" }
  $Reply = Ask "h7" "click" @{ x = 1; y = 1 }
  if ($Reply.error.code -ne "screenshot_stale") { throw "没截图就点没报 screenshot_stale" }
  $Reply = Ask "h8" "screenshot" @{}
  if ($Reply.result.width -lt 1) { throw "screenshot 没回图：$($Reply | ConvertTo-Json -Compress)" }
  Write-Host "助手冒烟通过"
} finally {
  $Writer.Close()
  if (-not $Process.WaitForExit(5000)) { $Process.Kill(); throw "关了 stdin 助手 5 秒没退" }
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}
