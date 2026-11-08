// 服务器上的两条账号命令（2026-11-08）：setup-link 打印一次性建账号链接（已有主人就说一句）；password --stdin
// 重设主人密码（只存哈希）。真的起一个 node 子进程跑，库在临时目录里。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { verifyPassword } from '../../src/app/password-hash.ts';
import { setupTokenHash } from '../../src/app/setup-link.ts';
import { openState } from '../../src/state/index.ts';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-cli-'));
  directories.push(directory);
  return directory;
}

function run(script: string, directory: string, input = '', args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [join('agent/src/app', script), ...args], { input, encoding: 'utf8',
    env: { ...process.env, PLASTICINE_STATE: directory, PLASTICINE_PORT: '8790', PLASTICINE_PUBLIC_URL: '',
      ...env } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('setup-link：还没有主人时打印 127.0.0.1 的一次性链接，库里只存令牌的哈希；再跑一次换新的', async () => {
  const directory = await stateDirectory();
  const first = run('setup-link-cli.ts', directory);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /30 分钟内有效，只能用一次/);
  const token = /http:\/\/127\.0\.0\.1:8790\/#\/setup\?t=([0-9A-Z-]+)/.exec(first.stdout)?.[1];
  assert.ok(token !== undefined, first.stdout);
  assert.equal(first.stdout.split('\n').filter((line) => line.includes('#/setup?t=')).length, 1);
  const second = run('setup-link-cli.ts', directory, '', [], { PLASTICINE_PUBLIC_URL: 'https://plasticine.test' });
  assert.match(second.stdout, /https:\/\/plasticine\.test\/#\/setup\?t=/, '配了对外地址另打一行');
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  try {
    assert.equal(state.ownerAccount.takeSetupToken(setupTokenHash(token), new Date().toISOString()), false,
      '旧的作废');
  } finally {
    state.close();
  }
});

test('setup-link：已经有主人就说一句，不发令牌', async () => {
  const directory = await stateDirectory();
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  const at = new Date().toISOString();
  state.devices.create({ name: '老手机', firstSeenAt: at, lastSeenAt: at });
  state.close();
  const result = run('setup-link-cli.ts', directory);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /已经有主人了/);
  assert.doesNotMatch(result.stdout, /setup\?t=/);
});

test('password --stdin：读一行设成新密码，库里只有哈希；太短的不改', async () => {
  const directory = await stateDirectory();
  const short = run('password-cli.ts', directory, 'short\n', ['--stdin']);
  assert.equal(short.code, 1);
  assert.match(short.stderr, /至少 8 位/);
  const done = run('password-cli.ts', directory, 'fake-cli-password\n', ['--stdin']);
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /密码改好了/);
  assert.doesNotMatch(done.stdout + done.stderr, /fake-cli-password/);
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  try {
    const stored = state.ownerAccount.credentials();
    assert.ok(stored !== null);
    assert.equal(await verifyPassword('fake-cli-password', stored), true);
  } finally {
    state.close();
  }
});

test('password：不是终端又没给 --stdin 就不读（不让密码回显）；没给 PLASTICINE_STATE 退出码 2', async () => {
  const directory = await stateDirectory();
  const piped = run('password-cli.ts', directory, 'fake-cli-password\n');
  assert.equal(piped.code, 1);
  assert.match(piped.stderr, /--stdin/);
  const missing = run('password-cli.ts', '', '', ['--stdin']);
  assert.equal(missing.code, 2);
});
