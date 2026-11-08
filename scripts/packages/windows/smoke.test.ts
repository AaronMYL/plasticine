import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('./smoke.ps1', import.meta.url));
const smoke = readFileSync(path, 'utf8');

// Linux 上验证等待契约；真正的安装、托盘和卸载仍由 windows-latest 的 smoke 执行。
test('安装冒烟只等安装器本身且有时限，不等待常驻托盘的进程树', () => {
  const starts = smoke.split(/\r?\n/).filter((line) => !line.trim().startsWith('#') && line.includes('Start-Process'));
  assert.ok(starts.length > 0);
  for (const line of starts) {
    assert.doesNotMatch(line, /\s-Wait(?:\s|$)/, 'Start-Process -Wait 会等常驻子进程');
    assert.match(line, /\s-PassThru(?:\s|$)/);
  }
  assert.match(smoke, /\.WaitForExit\(\$InstallerPollMs\)/);
  const idle = Number(smoke.match(/\$InstallerIdleTimeoutMs\s*=\s*(\d+)/)?.[1]);
  const total = Number(smoke.match(/\$InstallerTotalTimeoutMs\s*=\s*(\d+)/)?.[1]);
  assert.equal(idle, 120_000, '两分钟日志不前进才按停滞失败');
  assert.equal(total, 1_200_000, '总上限20分钟，持续进展也不能越过');
  assert.match(smoke, /\[System\.Diagnostics\.Stopwatch\]::StartNew\(\)/);
  assert.match(smoke, /Update-InstallerWait.*-ElapsedMs.*-LogBytes.*-Exited/);
  assert.doesNotMatch(smoke, /\bStop-Process\b|\.Kill\(/, '超时不能用杀托盘来伪造安装完成');
});

test('每次安装单独留日志，等待输出包含进程号、退出码和超时日志位置', () => {
  assert.match(smoke, /install-\$\(\$script:InstallAttempt\)\.log/);
  assert.match(smoke, /\$\(\$Process\.Id\)/);
  assert.match(smoke, /\$\(\$Process\.ExitCode\)/);
  assert.match(smoke, /Get-Content.*\$Log.*-Tail/);
  assert.match(smoke, /Dispose\(\)/);
  assert.match(smoke, /node --test \(Join-Path \$PSScriptRoot "smoke\.test\.ts"\)/);
  assert.match(smoke, /if \(\$LASTEXITCODE -ne 0\) \{ throw/);
});

const powershell = { skip: process.platform !== 'win32' ? '只在 Windows 上通过 pwsh 验证策略边界' : false };

/** 只载入真正使用的等待策略函数；不给安装器/托盘造进程，也不运行 smoke 的主程序。 */
function decisions(samples: ReadonlyArray<{ at: number; bytes: number; exited?: boolean }>): string[] {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$waitTokens = $null; $waitParseErrors = $null',
    `$waitAst = [System.Management.Automation.Language.Parser]::ParseFile('${path.replaceAll("'", "''")}',`
      + '[ref]$waitTokens, [ref]$waitParseErrors)',
    'if ($waitParseErrors.Count -gt 0) { throw $waitParseErrors[0].Message }',
    '$waitFunction = $waitAst.Find({ param($entry)',
    '  $entry -is [System.Management.Automation.Language.FunctionDefinitionAst]'
      + " -and $entry.Name -eq 'Update-InstallerWait'",
    '}, $false)',
    "if ($null -eq $waitFunction) { throw 'waiting policy missing' }",
    'Invoke-Expression $waitFunction.Extent.Text',
    '$waitState = @{ LogBytes = 0L; LastProgressMs = 0L; IdleTimeoutMs = 120000L; TotalTimeoutMs = 1200000L }',
    '$waitResults = @()',
    ...samples.map((sample) => `$waitResults += Update-InstallerWait -State $waitState -ElapsedMs ${sample.at}`
      + ` -LogBytes ${sample.bytes} -Exited $${sample.exited === true ? 'true' : 'false'}`),
    'ConvertTo-Json -InputObject @($waitResults) -Compress',
  ].join('\n');
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout.trim()) as string[];
}

test('PowerShell策略：日志没有新增内容，满120秒按停滞失败', powershell, () => {
  assert.deepEqual(decisions([{ at: 0, bytes: 10 }, { at: 119_999, bytes: 10 }, { at: 120_000, bytes: 10 }]),
    ['running', 'running', 'stalled']);
});

test('PowerShell策略：持续进展越过旧180秒限制，安装器最终退出才成功', powershell, () => {
  assert.deepEqual(decisions([{ at: 0, bytes: 10 }, { at: 90_000, bytes: 20 }, { at: 180_000, bytes: 30 },
    { at: 270_000, bytes: 40 }, { at: 360_000, bytes: 40, exited: true }]),
  ['running', 'running', 'running', 'running', 'completed']);
});

test('PowerShell策略：持续新增日志也不能推迟20分钟总上限', powershell, () => {
  const samples = Array.from({ length: 14 }, (_, i) => ({ at: i * 90_000, bytes: i * 10 }));
  samples.push({ at: 1_200_000, bytes: 150 });
  const result = decisions(samples);
  assert.ok(result.slice(0, -1).every((state) => state === 'running'));
  assert.equal(result.at(-1), 'deadline');
  assert.deepEqual(decisions([{ at: 1_200_001, bytes: 100, exited: true }]), ['deadline']);
});
