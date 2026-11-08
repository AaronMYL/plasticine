# Windows 安装包冒烟（CI 的 windows-latest 跑；docs/install-packages.md「怎么验证」）：
#   pwsh scripts/packages/windows/smoke.ps1 -Setup dist\packages\Plasticine-Setup-<版本>.exe
# 静默安装 → 托盘和服务起来、答 /v2/health、发客户端 → 静默卸载（数据留着）→ 再装再卸、带 /DELETEDATA=1（数据删掉）。
param([Parameter(Mandatory = $true)][string]$Setup)
$ErrorActionPreference = "Stop"
$App = Join-Path $env:LOCALAPPDATA "Programs\Plasticine"
$Data = Join-Path $env:LOCALAPPDATA "Plasticine"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$Health = "http://127.0.0.1:8790/v2/health"
# #439 第三轮在180秒时仍持续写文件；日志停止前进才判停滞，总上限保持独立，不能被进展续期。
$InstallerIdleTimeoutMs = 120000
$InstallerTotalTimeoutMs = 1200000
$InstallerPollMs = 1000
$script:InstallAttempt = 0

function Wait-Until([scriptblock]$Check, [int]$Seconds, [string]$What) {
  $Deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $Deadline) {
    if (& $Check) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "$Seconds 秒内没等到：$What"
}

function Test-Healthy {
  try {
    $Answer = Invoke-RestMethod -Uri $Health -TimeoutSec 2 -NoProxy
    return $Answer.ok -eq $true
  } catch {
    return $false
  }
}

function Update-InstallerWait([hashtable]$State, [long]$ElapsedMs, [long]$LogBytes, [bool]$Exited) {
  if ($ElapsedMs -ge $State.TotalTimeoutMs) { return "deadline" }
  if ($Exited) { return "completed" }
  if ($LogBytes -gt $State.LogBytes) {
    $State.LogBytes = $LogBytes
    $State.LastProgressMs = $ElapsedMs
  }
  if ($ElapsedMs - $State.LastProgressMs -ge $State.IdleTimeoutMs) { return "stalled" }
  return "running"
}

function Wait-InstallerExit([System.Diagnostics.Process]$Process, [string]$Action, [string]$Log) {
  Write-Host "$Action：PID $($Process.Id)，日志 $Log"
  $Clock = [System.Diagnostics.Stopwatch]::StartNew()
  $Progress = @{ LogBytes = 0L; LastProgressMs = 0L
    IdleTimeoutMs = $InstallerIdleTimeoutMs; TotalTimeoutMs = $InstallerTotalTimeoutMs }
  $NextReportMs = 30000
  try {
    # Start-Process -Wait 会等全部子进程；安装器启动的常驻托盘本来就不应在这里退出。
    while ($true) {
      $Exited = $Process.WaitForExit($InstallerPollMs)
      $ElapsedMs = $Clock.ElapsedMilliseconds
      $LogBytes = 0L
      if (Test-Path -LiteralPath $Log) { $LogBytes = (Get-Item -LiteralPath $Log).Length }
      $State = Update-InstallerWait -State $Progress -ElapsedMs $ElapsedMs -LogBytes $LogBytes -Exited $Exited
      if ($State -eq "completed") { break }
      if ($State -ne "running") {
        if (Test-Path -LiteralPath $Log) { Get-Content -LiteralPath $Log -Tail 80 }
        $Reason = "日志 $($InstallerIdleTimeoutMs / 1000) 秒没有新增内容"
        if ($State -eq "deadline") { $Reason = "超过 $($InstallerTotalTimeoutMs / 60000) 分钟总时限" }
        throw "$Action 进程 $($Process.Id) $Reason；保留进程，查看 $Log"
      }
      if ($ElapsedMs -ge $NextReportMs) {
        Write-Host "$Action：PID $($Process.Id)，已等待 $([int]($ElapsedMs / 1000)) 秒，日志 $LogBytes 字节"
        $NextReportMs = $ElapsedMs + 30000
      }
    }
    $Process.Refresh()
    Write-Host "$Action：PID $($Process.Id) 已退出，退出码 $($Process.ExitCode)"
    if ($Process.ExitCode -ne 0) { throw "$Action 退出码 $($Process.ExitCode)，查看 $Log" }
  } finally {
    $Clock.Stop()
    $Process.Dispose()
  }
}

function Install-Plasticine {
  $script:InstallAttempt += 1
  $Log = Join-Path $env:RUNNER_TEMP "install-$($script:InstallAttempt).log"
  $Arguments = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$Log`"")
  $Process = Start-Process -FilePath $Setup -ArgumentList $Arguments -PassThru
  Wait-InstallerExit $Process "安装器" $Log
}

# 卸载器会把自己拷到临时目录再跑；原进程退出后，还要按程序文件消失确认卸载完成。
function Uninstall-Plasticine([string[]]$Extra) {
  $Log = Join-Path $env:RUNNER_TEMP "uninstall-$($script:InstallAttempt).log"
  $Arguments = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$Log`"") + $Extra
  $Process = Start-Process -FilePath (Join-Path $App "unins000.exe") -ArgumentList $Arguments -PassThru
  Wait-InstallerExit $Process "卸载器" $Log
  Wait-Until { -not (Test-Path (Join-Path $App "PlasticineTray.exe")) } 120 "程序文件删掉"
}

# 在同一个 Windows 环境里先验证实际 PowerShell 策略；测试失败就停止，不继续操作安装器。
node --test (Join-Path $PSScriptRoot "smoke.test.ts")
if ($LASTEXITCODE -ne 0) { throw "Windows 安装等待策略测试没有通过" }

Write-Host "· 静默安装"
Install-Plasticine
Wait-Until { Test-Healthy } 120 "服务答上健康检查"
$Page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8790/" -TimeoutSec 5 -NoProxy
if ($Page.StatusCode -ne 200 -or $Page.Content -notmatch "<html") { throw "首页没发出来" }
if (-not (Test-Path (Join-Path $Data "state\plasticine.sqlite"))) { throw "数据目录里没有库" }
if (-not (Get-Process -Name PlasticineTray -ErrorAction SilentlyContinue)) { throw "托盘没在跑" }
$Run = Get-ItemProperty -Path $RunKey -Name Plasticine -ErrorAction SilentlyContinue
if (-not $Run) { throw "第一次运行没设开机启动" }
if (-not (Test-Path (Join-Path $Data "installers\$(Split-Path -Leaf $Setup)"))) { throw "安装程序没留一份做回退" }

Write-Host "· 再装一次（升级路径：托盘先退出、文件换掉、托盘再起来）"
Install-Plasticine
Wait-Until { Test-Healthy } 120 "重装后服务答上健康检查"

Write-Host "· 静默卸载：程序删掉、服务停了、数据留着"
Uninstall-Plasticine @()
Wait-Until { -not (Test-Healthy) } 30 "服务停掉"
if (-not (Test-Path (Join-Path $Data "state\plasticine.sqlite"))) { throw "卸载把数据删了" }
if (Get-ItemProperty -Path $RunKey -Name Plasticine -ErrorAction SilentlyContinue) {
  throw "卸载没去掉开机启动"
}

Write-Host "· 再装、带 /DELETEDATA=1 卸载：数据也删掉"
Install-Plasticine
Wait-Until { Test-Healthy } 120 "重装后服务答上健康检查"
Uninstall-Plasticine @("/DELETEDATA=1")
Wait-Until { -not (Test-Path $Data) } 60 "数据目录删掉"
Write-Host "Windows 安装包冒烟：通过"
