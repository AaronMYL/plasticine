import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeviceLimits } from '../../agent/shared/state.ts';
import { DeviceGuard } from '../src/node/device-guard.ts';

function limits(change: Partial<DeviceLimits> = {}): DeviceLimits {
  const allow = { mode: 'allow' as const, perHour: 10_000 };
  return { roots: [], apps: [], sites: [], unattendedInput: true,
    classes: { read: allow, write: allow, delete: { mode: 'confirm_each', perHour: 10_000 }, command: allow,
      browser: allow, input: allow }, ...change };
}

test('付款页默认关死；上限放开成每次问才降为确认', () => {
  const guard = new DeviceGuard();
  const action = { kind: 'tab_open' as const, url: 'https://www.alipay.com/pay' };
  assert.equal(guard.decide(action, limits()).kind, 'refuse');
  assert.equal(guard.decide(action, limits({ payments: 'confirm_each' })).kind, 'confirm');
});

test('读钥匙串、sudo 这类命令要他点一次；删除每次都问', () => {
  const guard = new DeviceGuard();
  assert.equal(guard.decide({ kind: 'run_command', cwd: '~', command: 'sudo rm -rf /tmp/x' }, limits()).kind,
    'confirm');
  assert.equal(guard.decide({ kind: 'file_read', path: '~/.ssh/id_ed25519' }, limits()).kind, 'confirm');
  const deletion = guard.decide({ kind: 'file_delete', path: '~/a.txt' }, limits({ classes: { ...limits().classes,
    delete: { mode: 'allow', perHour: 10 } } }));
  assert.deepEqual(deletion.kind, 'confirm');
  assert.equal(guard.decide({ kind: 'file_read', path: '~/a.txt' }, limits()).kind, 'allow');
});

test('这一类关着就拒；一小时次数到了就拒', () => {
  let now = 0;
  const guard = new DeviceGuard(() => now);
  const action = { kind: 'screen_capture' as const };
  const capped = limits({ classes: { ...limits().classes, input: { mode: 'allow', perHour: 2 } } });
  guard.record(action);
  guard.record(action);
  assert.equal(guard.decide(action, capped).kind, 'refuse');
  now = 60 * 60 * 1000 + 1;
  assert.equal(guard.decide(action, capped).kind, 'allow');
  const closed = limits({ classes: { ...limits().classes, command: { mode: 'deny', perHour: 10 } } });
  assert.equal(guard.decide({ kind: 'run_command', cwd: '~', command: 'ls' }, closed).kind, 'refuse');
});

test('云端设了应用、站点清单才再限一层', () => {
  const guard = new DeviceGuard();
  assert.equal(guard.decide({ kind: 'app_open', app: 'Notes' }, limits()).kind, 'allow');
  assert.equal(guard.decide({ kind: 'app_open', app: 'Notes' }, limits({ apps: ['Safari'] })).kind, 'refuse');
  const scoped = limits({ sites: ['github.com'] });
  assert.equal(guard.decide({ kind: 'tab_open', url: 'https://gist.github.com/x' }, scoped).kind, 'allow');
  assert.equal(guard.decide({ kind: 'tab_open', url: 'https://example.com/' }, scoped).kind, 'refuse');
});
