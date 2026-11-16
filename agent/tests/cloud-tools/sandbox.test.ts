// 沙盒（11-16）：代码和带进来的文件放进一次性的工作目录，out/ 里的拿回来，用完删掉；起单元的参数把本机和内网挡住、
// 系统只读、临时用户。测试不起 systemd：换成在工作目录里直接跑同一个解释器。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Sandbox, type LaunchResult } from '../../src/cloud-tools/index.ts';

const HAS_PYTHON = spawnSync('python3', ['--version']).status === 0;

function direct(seen: string[][]): (args: readonly string[], cwd: string) => Promise<LaunchResult> {
  return async (args, cwd) => {
    seen.push([...args]);
    const [interpreter = '', script = ''] = args.slice(-2);
    const ran = spawnSync(interpreter === '/usr/bin/python3' ? 'python3' : interpreter, [script], { cwd });
    return { code: ran.status, stdout: ran.stdout.toString(), stderr: ran.stderr.toString() };
  };
}

test('沙盒跑 Python：in/ 里有带进来的文件，out/ 里写的拿回来，工作目录用完删掉', {
  skip: HAS_PYTHON ? false : '这台机器没有 python3' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
  try {
    const seen: string[][] = [];
    const sandbox = new Sandbox({ root, launch: direct(seen) });
    const result = await sandbox.run({ language: 'python', timeoutSeconds: 30,
      code: 'rows = open("in/名单.csv").read().splitlines()\nprint(len(rows))\nopen("out/统计.txt", "w").write("2 行")',
      files: [{ name: '../名单.csv', data: Buffer.from('a\nb\n') }] }, AbortSignal.timeout(30_000));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), '2');
    assert.deepEqual(result.outputs.map((file) => [file.name, file.data.toString()]), [['统计.txt', '2 行']]);
    assert.deepEqual(readdirSync(root), []);
    const args = seen[0] ?? [];
    assert.ok(args.includes('DynamicUser=yes'));
    assert.ok(args.includes('ProtectSystem=strict'));
    assert.ok(args.some((arg) => arg.startsWith('IPAddressDeny=127.0.0.0/8')));
    assert.ok(args.some((arg) => arg.startsWith('BindPaths=') && arg.endsWith(':/work')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('不在 Linux 上（或没有 systemd-run）就没有沙盒，说清楚', async () => {
  const sandbox = new Sandbox({ root: tmpdir(), platform: 'darwin' });
  assert.equal(sandbox.available(), false);
  await assert.rejects(sandbox.run({ language: 'node', code: '1', files: [], timeoutSeconds: 1 },
    AbortSignal.timeout(1_000)), /没有沙盒/);
  assert.equal(existsSync(join(tmpdir(), 'in')), false);
});
