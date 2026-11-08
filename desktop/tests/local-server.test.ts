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

function server(options: { healthy: boolean[] }): { local: LocalServer; children: FakeChild[]; logs: string[] } {
  const children: FakeChild[] = [];
  const logs: string[] = [];
  let checks = 0;
  const local = new LocalServer({
    launch: () => {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
    healthy: async () => options.healthy[checks++] ?? true,
    now: () => Date.now(),
    log: (line) => logs.push(line),
  }, true);
  return { local, children, logs };
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
