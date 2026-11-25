export const HEALTH_WAIT_SECONDS = 90;

export interface MacSwapInput {
  pid: number;
  app: string;
  incoming: string;
  previous: string;
  marker: string;
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
  previousSetup: string | null;
  marker: string;
  rolledBack: string;
  version: string;
  exeName: string;
  installed: string;
  log: string;
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
    `$Installed = ${psQuote(input.installed)}`,
    `Start-Transcript -LiteralPath ${psQuote(input.log)} -Force | Out-Null`,
    `Wait-Process -Id ${input.pid} -Timeout 30 -ErrorAction SilentlyContinue`,
    `Get-Process -Id ${input.pid} -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq $ExeName } |`
      + ' Stop-Process -Force',
    'Remove-Item -LiteralPath $Marker -ErrorAction SilentlyContinue',
    "Start-Process -FilePath $Setup -ArgumentList '/S','--updated','--force-run' -Wait",
    'for ($i = 0; $i -lt 10; $i++) {',
    '  if (Get-Process -Name $ExeName -ErrorAction SilentlyContinue) { break }',
    '  Start-Sleep -Seconds 1',
    '}',
    'if (-not (Get-Process -Name $ExeName -ErrorAction SilentlyContinue)) { Start-Process -FilePath $Installed }',
    `for ($i = 0; $i -lt ${input.waitSeconds}; $i++) {`,
    '  if (Test-Path -LiteralPath $Marker) { exit 0 }',
    '  Start-Sleep -Seconds 1',
    '}',
    'if ($Previous -eq $null) { exit 2 }',
    'Get-Process -Name $ExeName -ErrorAction SilentlyContinue | Stop-Process -Force',
    "Start-Process -FilePath $Previous -ArgumentList '/S','--updated','--force-run' -Wait",
    'if (-not (Get-Process -Name $ExeName -ErrorAction SilentlyContinue)) { Start-Process -FilePath $Installed }',
    '$At = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")',
    "$Record = '{\"failed\":\"' + $Version + '\",\"at\":\"' + $At + '\"}'",
    'Set-Content -LiteralPath $Rolled -Encoding UTF8 -Value $Record',
    'exit 2',
    '',
  ].join('\r\n');
}
