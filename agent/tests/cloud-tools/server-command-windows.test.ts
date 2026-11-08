// 只在 Windows 上跑（CI 的 Windows 安装包任务）：安装包里的服务器命令走 PowerShell，路径经 node:path。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { ServerCommands } from '../../src/cloud-tools/server-command.ts';
import { tempDirectory } from '../state/helpers.ts';

const onWindows = { skip: process.platform !== 'win32' ? '只在 Windows 上跑' : false };
let dir: Awaited<ReturnType<typeof tempDirectory>>;
beforeEach(async () => { dir = await tempDirectory(); });
afterEach(async () => { await dir.cleanup(); });
const identity = { actionId: 'task-1:step:g0:server_exec:win', runId: 'run-1', taskId: 'task-1' };
const signal = new AbortController().signal;
const store = () => new ServerCommands({ stateDirectory: dir.directory, cwd: dir.directory });

test('Windows：PowerShell 跑脚本、读写文件，中文输出不乱码，退出码照实', onWindows, async () => {
  const target = join(dir.directory, '笔记 草稿.txt');
  const script = [
    `Set-Content -LiteralPath '${target}' -Value '你好，Plasticine' -Encoding UTF8`,
    `Get-Content -LiteralPath '${target}' -Encoding UTF8`,
    "Write-Error '出了点问题' -ErrorAction Continue",
    'exit 3',
  ].join('\n');
  const result = await store().execute({ script }, identity, signal);
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 3);
  assert.match(store().read(result.id, 'stdout').text, /你好，Plasticine/);
  assert.match(store().read(result.id, 'stderr').text, /出了点问题/);
  assert.match(readFileSync(target, 'utf8'), /你好，Plasticine/);
});

test('Windows：超时连子进程一起结束（taskkill /T）', onWindows, async () => {
  const marker = join(dir.directory, 'escaped.txt');
  const script = `Start-Process -NoNewWindow powershell -ArgumentList '-NoProfile','-Command',`
    + `"Start-Sleep -Seconds 3; Set-Content -LiteralPath '${marker}' -Value x"\nStart-Sleep -Seconds 30`;
  const result = await store().execute({ script, timeoutMs: 1500 }, identity, signal);
  assert.equal(result.status, 'timed_out');
  await new Promise((resolve) => setTimeout(resolve, 4000));
  assert.equal(existsSync(marker), false);
});
