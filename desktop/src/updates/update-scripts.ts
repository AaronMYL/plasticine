// 客户端自更新最后那一步的脚本（客户端退出以后由它换版本、重新打开、看新版起没起来，起不来就退回上一版）。
// 写成纯文本生成，测试里在 Linux 上把 Mac 的那份真跑一遍（open、lsregister 换成假的）。
// - Mac：只换 Plasticine.app 里的 Contents，文件夹本身不动——Dock、「应用程序」、登录项记的是这个文件夹（0.7.1 修过的
//   Dock 图标失效，mac/README.md「自签证书与自更新」）。旧的 Contents 挪进「上一版」留着回退。
// - Windows：静默跑 NSIS 安装程序（/S --updated --force-run），新版起不来就静默装回上一版的安装程序。
// 「起来了」= 新版主窗口载入完写下的记号文件（started-<版本>）；等不到就算坏版本，退回并记下这一版不再自动装
// （和 Linux 包 updater.ts 的健康检查同一个意思）。

/** 新版多久内要写下「起来了」的记号。 */
export const HEALTH_WAIT_SECONDS = 90;

export interface MacSwapInput {
  pid: number;
  /** 正在用的 Plasticine.app（文件夹不动，只换里面的 Contents）。 */
  app: string;
  /** 解好、重签好的新版 .app。 */
  incoming: string;
  /** 旧 Contents 放到这里（<上一版目录>/Plasticine.app/Contents）。 */
  previous: string;
  marker: string;
  /** 坏版本退回后写这个文件（{ failed, at }），新版下次启动读到就记成不再自动装。 */
  rolledBack: string;
  version: string;
  open: string;
  lsregister: string;
  waitSeconds: number;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function macSwapScript(input: MacSwapInput): string {
  return [
    '#!/bin/sh',
    '# Plasticine 客户端换版本（desktop/src/updates/update-scripts.ts 生成）。',
    `PID=${input.pid}`,
    `APP=${quote(input.app)}`,
    `INCOMING=${quote(input.incoming)}`,
    `PREVIOUS=${quote(input.previous)}`,
    `MARKER=${quote(input.marker)}`,
    `ROLLED=${quote(input.rolledBack)}`,
    `VERSION=${quote(input.version)}`,
    `OPEN=${quote(input.open)}`,
    `LSREGISTER=${quote(input.lsregister)}`,
    'i=0',
    'while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 300 ]; do sleep 0.1; i=$((i+1)); done',
    'reopen() { touch "$APP"; "$LSREGISTER" -f "$APP" >/dev/null 2>&1; "$OPEN" "$APP"; }',
    '[ -d "$INCOMING/Contents" ] || { reopen; exit 1; }',
    'rm -rf "$PREVIOUS.new" && mkdir -p "$PREVIOUS.new" || { reopen; exit 1; }',
    'mv "$APP/Contents" "$PREVIOUS.new/Contents" || { reopen; exit 1; }',
    'if ! mv "$INCOMING/Contents" "$APP/Contents"; then',
    '  rm -rf "$APP/Contents"; mv "$PREVIOUS.new/Contents" "$APP/Contents"; reopen; exit 1',
    'fi',
    'rm -rf "$PREVIOUS" && mv "$PREVIOUS.new" "$PREVIOUS"',
    'rm -f "$MARKER"',
    'reopen',
    'i=0',
    `while [ "$i" -lt ${input.waitSeconds} ]; do [ -f "$MARKER" ] && exit 0; sleep 1; i=$((i+1)); done`,
    '# 新版没起来：结束它，换回上一版。',
    'pkill -f "$APP/Contents/MacOS/" 2>/dev/null; sleep 2',
    'rm -rf "$INCOMING/Contents" && mv "$APP/Contents" "$INCOMING/Contents"',
    'mv "$PREVIOUS/Contents" "$APP/Contents"',
    'printf \'{"failed":"%s","at":"%s"}\\n\' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ROLLED"',
    'reopen',
    'exit 2',
    '',
  ].join('\n');
}

export interface WindowsInstallInput {
  pid: number;
  setup: string;
  /** 上一版的安装程序；没有（第一次手动装的那一版）是 null，起不来就只能等他手动装。 */
  previousSetup: string | null;
  marker: string;
  rolledBack: string;
  version: string;
  /** 主程序的文件名（结束没起来的新版用）。 */
  exeName: string;
  waitSeconds: number;
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function windowsInstallScript(input: WindowsInstallInput): string {
  const previous = input.previousSetup === null ? '$null' : psQuote(input.previousSetup);
  return [
    '# Plasticine 客户端换版本（desktop/src/updates/update-scripts.ts 生成）。',
    "$ErrorActionPreference = 'Continue'",
    `$Setup = ${psQuote(input.setup)}`,
    `$Previous = ${previous}`,
    `$Marker = ${psQuote(input.marker)}`,
    `$Rolled = ${psQuote(input.rolledBack)}`,
    `$Version = ${psQuote(input.version)}`,
    `$ExeName = ${psQuote(input.exeName.replace(/\.exe$/i, ''))}`,
    `Wait-Process -Id ${input.pid} -Timeout 30 -ErrorAction SilentlyContinue`,
    'Remove-Item -LiteralPath $Marker -ErrorAction SilentlyContinue',
    "Start-Process -FilePath $Setup -ArgumentList '/S','--updated','--force-run' -Wait",
    `for ($i = 0; $i -lt ${input.waitSeconds}; $i++) {`,
    '  if (Test-Path -LiteralPath $Marker) { exit 0 }',
    '  Start-Sleep -Seconds 1',
    '}',
    'if ($Previous -eq $null) { exit 2 }',
    'Get-Process -Name $ExeName -ErrorAction SilentlyContinue | Stop-Process -Force',
    "Start-Process -FilePath $Previous -ArgumentList '/S','--updated','--force-run' -Wait",
    '$At = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")',
    "$Record = '{\"failed\":\"' + $Version + '\",\"at\":\"' + $At + '\"}'",
    'Set-Content -LiteralPath $Rolled -Encoding UTF8 -Value $Record',
    'exit 2',
    '',
  ].join('\r\n');
}
