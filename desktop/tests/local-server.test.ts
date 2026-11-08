import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { LocalServer, RestartBackoff, serverEnvironment } from '../src/app/local-server.ts';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdinEnded = false;
  signals: string[] = [];
  constructor() {
    super();
    this.stdin.on('finish', () => {
      this.stdinEnded = true;
    });
  }
  kill(signal: string): boolean {
    this.signals.push(signal);
    setImmediate(() => this.emit('exit', null, signal));
    return true;
  }
}

function server(options: { healthy: boolean[] }): { local: LocalServer; children: FakeChild[]; logs: string[];
  tokens: string[]; } {
  const children: FakeChild[] = [];
  const tokens: string[] = [];
  const logs: string[] = [];
  let checks = 0;
  const local = new LocalServer({
    launch: (token) => {
      const child = new FakeChild();
      tokens.push(token);
      children.push(child);
      return child as unknown as ChildProcess;
    },
    healthy: async () => options.healthy[checks++] ?? true,
    now: () => Date.now(),
    log: (line) => logs.push(line),
  }, true);
  return { local, children, logs, tokens };
}

test('退避：1、2、4…30 秒，稳定跑满一分钟归零', () => {
  const backoff = new RestartBackoff();
  assert.deepEqual([0, 0, 0, 0, 0, 0, 0].map(() => backoff.next(10)), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
    30_000]);
  assert.equal(backoff.next(60_000), 1_000);
});

test('本体环境只带几样系统变量，加上安装包的设置', () => {
  const environment = serverEnvironment({ platform: 'darwin', serverDirectory: '/app/server', stateDirectory: '/s',
    base: { HOME: '/Users/a', SECRET_TOKEN: 'x', LANG: 'zh_CN.UTF-8' }, join });
  assert.equal(environment.HOME, '/Users/a');
  assert.equal(environment.SECRET_TOKEN, undefined);
  assert.equal(environment.PLASTICINE_STATE, '/s');
  assert.equal(environment.PLASTICINE_PORT, '8790');
  assert.equal(environment.PLASTICINE_CLIENT_DIR, '/app/server/client/dist');
  assert.equal(environment.PLASTICINE_STOP_ON_STDIN_EOF, '1');
  assert.match(environment.PATH ?? '', /homebrew/);
  const windows = serverEnvironment({ platform: 'win32', serverDirectory: 'C:\\s', stateDirectory: 'C:\\st',
    base: { PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows' }, join });
  assert.equal(windows.PATH, 'C:\\Windows');
  assert.equal(windows.SystemRoot, 'C:\\Windows');
});

test('起本体等到健康检查答上；停的时候先关 stdin 再发 SIGTERM', async () => {
  const { local, children } = server({ healthy: [true] });
  assert.equal(await local.start(), true);
  assert.equal(local.state, 'running');
  await local.stop();
  assert.equal(local.state, 'stopped');
  assert.ok(children[0]?.stdinEnded);
  assert.deepEqual(children[0]?.signals, ['SIGTERM']);
});

test('本体崩了按退避重启，状态里写原因', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { local, children } = server({ healthy: [true, true] });
  await local.start();
  children[0]?.emit('exit', 1, null);
  assert.equal(local.state, 'failed');
  assert.match(local.problem ?? '', /退出了（1）/);
  t.mock.timers.tick(1_000);
  assert.equal(children.length, 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(local.state, 'running');
});

test('没带本体：不拉起，状态是 absent 并说去选远程', async () => {
  const local = new LocalServer({ launch: () => { throw new Error('不该调'); }, healthy: async () => true,
    now: () => 0, log: () => undefined }, false);
  assert.equal(await local.start(), false);
  assert.equal(local.state, 'absent');
  assert.match(local.problem ?? '', /远程/);
});

test('每次起本体都换一个本机令牌，经环境变量交给本体，停了就没有', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { local, children, tokens, logs } = server({ healthy: [true, true] });
  assert.equal(local.token, null);
  await local.start();
  assert.equal(tokens.length, 1);
  assert.match(tokens[0] ?? '', /^[A-Za-z0-9_-]{43}$/);
  assert.equal(local.token, tokens[0]);
  children[0]?.emit('exit', 1, null);
  assert.equal(local.token, null);
  t.mock.timers.tick(1_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[1], tokens[0]);
  assert.equal(local.token, tokens[1]);
  await local.stop();
  assert.equal(local.token, null);
  assert.ok(logs.every((line) => !tokens.some((token) => line.includes(token))));
  const environment = serverEnvironment({ platform: 'darwin', serverDirectory: '/app/server', stateDirectory: '/s',
    base: {}, join, localToken: 'fake-local-token' });
  assert.equal(environment.PLASTICINE_LOCAL_TOKEN, 'fake-local-token');
});
