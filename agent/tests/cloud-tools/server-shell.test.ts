import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { killProcessTree, shellFor } from '../../src/cloud-tools/server-shell.ts';
import { tempDirectory } from '../state/helpers.ts';

test('Linux / Mac 用 bash，自成进程组，好整组结束', () => {
  const shell = shellFor('echo 你好', '/tmp/x', 'linux');
  assert.equal(shell.command, '/bin/bash');
  assert.deepEqual(shell.args, ['--noprofile', '--norc', '-c', 'echo 你好']);
  assert.equal(shell.detached, true);
});

test('Windows 用 PowerShell 跑写进动作目录的脚本文件，输出改成 UTF-8（中文不乱码）', async (t) => {
  const { directory, cleanup } = await tempDirectory();
  t.after(cleanup);
  const shell = shellFor('Write-Output "你好"\nGet-ChildItem C:\\', directory, 'win32');
  assert.equal(shell.command, 'powershell.exe');
  assert.deepEqual(shell.args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(directory, 'script.ps1')]);
  assert.equal(shell.detached, false);
  const written = readFileSync(join(directory, 'script.ps1'));
  // 带 BOM：Windows PowerShell 5.1 没有 BOM 时按本地代码页读脚本。
  assert.deepEqual([...written.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = written.subarray(3).toString('utf8');
  assert.match(text, /\[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8/);
  assert.ok(text.endsWith('Write-Output "你好"\nGet-ChildItem C:\\\n'));
});

test('结束进程树：POSIX 杀整个进程组，进程已经没了不算错', () => {
  const killed: Array<[number, string]> = [];
  killProcessTree(42, 'linux', { kill: (pid, signal) => { killed.push([pid, String(signal)]); return true; } });
  assert.deepEqual(killed, [[-42, 'SIGKILL']]);
  const gone = Object.assign(new Error('no such process'), { code: 'ESRCH' });
  assert.doesNotThrow(() => killProcessTree(42, 'linux', { kill: () => { throw gone; } }));
  const denied = Object.assign(new Error('not permitted'), { code: 'EPERM' });
  assert.throws(() => killProcessTree(42, 'linux', { kill: () => { throw denied; } }), /not permitted/);
});

test('结束进程树：Windows 用 taskkill /T /F 连子进程一起结束', () => {
  const calls: string[][] = [];
  killProcessTree(42, 'win32', { run: (command, args) => { calls.push([command, ...args]); return { status: 0 }; } });
  assert.deepEqual(calls, [['taskkill', '/pid', '42', '/T', '/F']]);
  // 128：进程已经结束，不算错。
  assert.doesNotThrow(() => killProcessTree(42, 'win32', { run: () => ({ status: 128 }) }));
  assert.throws(() => killProcessTree(42, 'win32', { run: () => ({ status: 1 }) }), /taskkill/);
});
