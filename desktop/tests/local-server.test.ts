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

test('backs off 1, 2, 4...30s and resets after 1 minute of stable uptime', () => {
  const backoff = new RestartBackoff();
  assert.deepEqual([0, 0, 0, 0, 0, 0, 0].map(() => backoff.next(10)), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
    30_000]);
  assert.equal(backoff.next(60_000), 1_000);
});

test('passes only whitelisted OS env vars plus installer config to agent', () => {
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

test('starts agent until health check responds and stops by closing stdin then SIGTERM', async () => {
  const { local, children } = server({ healthy: [true] });
  assert.equal(await local.start(), true);
  assert.equal(local.state, 'running');
  await local.stop();
  assert.equal(local.state, 'stopped');
  assert.ok(children[0]?.stdinEnded);
  assert.deepEqual(children[0]?.signals, ['SIGTERM']);
});

test('restarts crashed agent with backoff and records reason in status', async (t) => {
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

test('missing bundled agent does not spawn, reports absent, and directs to remote', async () => {
  const local = new LocalServer({ launch: () => { throw new Error('不该调'); }, healthy: async () => true,
    now: () => 0, log: () => undefined }, false);
  assert.equal(await local.start(), false);
  assert.equal(local.state, 'absent');
  assert.match(local.problem ?? '', /远程/);
});

test('rotates local token via env on each agent start and clears it on stop', async (t) => {
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
