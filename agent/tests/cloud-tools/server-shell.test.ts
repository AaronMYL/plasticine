import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { killProcessTree, shellFor } from '../../src/cloud-tools/server-shell.ts';
import { tempDirectory } from '../state/helpers.ts';

test('Linux/Mac runs bash in its own process group for clean group termination', () => {
  const shell = shellFor('echo 你好', '/tmp/x', 'linux');
  assert.equal(shell.command, '/bin/bash');
  assert.deepEqual(shell.args, ['--noprofile', '--norc', '-c', 'echo 你好']);
  assert.equal(shell.detached, true);
});

test('Windows runs PowerShell script file in action dir with UTF-8 output encoding', async (t) => {
  const { directory, cleanup } = await tempDirectory();
  t.after(cleanup);
  const shell = shellFor('Write-Output "你好"\nGet-ChildItem C:\\', directory, 'win32');
  assert.equal(shell.command, 'powershell.exe');
  assert.deepEqual(shell.args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(directory, 'script.ps1')]);
  assert.equal(shell.detached, false);
  const written = readFileSync(join(directory, 'script.ps1'));
  assert.deepEqual([...written.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = written.subarray(3).toString('utf8');
  assert.match(text, /\[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8/);
  assert.ok(text.endsWith('Write-Output "你好"\nGet-ChildItem C:\\\n'));
});

test('kill process tree terminates POSIX process group and ignores already-exited processes', () => {
  const killed: Array<[number, string]> = [];
  killProcessTree(42, 'linux', { kill: (pid, signal) => {
    killed.push([pid, String(signal)]);
    return true;
  } });
  assert.deepEqual(killed, [[-42, 'SIGKILL']]);
  const gone = Object.assign(new Error('no such process'), { code: 'ESRCH' });
  assert.doesNotThrow(() => killProcessTree(42, 'linux', { kill: () => { throw gone; } }));
  const denied = Object.assign(new Error('not permitted'), { code: 'EPERM' });
  assert.throws(() => killProcessTree(42, 'linux', { kill: () => { throw denied; } }), /not permitted/);
});

test('kill process tree on Windows uses taskkill /T /F to stop child processes', () => {
  const calls: string[][] = [];
  killProcessTree(42, 'win32', { run: (command, args) => {
    calls.push([command, ...args]);
    return { status: 0 };
  } });
  assert.deepEqual(calls, [['taskkill', '/pid', '42', '/T', '/F']]);
  assert.doesNotThrow(() => killProcessTree(42, 'win32', { run: () => ({ status: 128 }) }));
  assert.throws(() => killProcessTree(42, 'win32', { run: () => ({ status: 1 }) }), /taskkill/);
});
