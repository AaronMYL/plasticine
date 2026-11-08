import assert from 'node:assert/strict';
import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { NodeWireAction } from '../../agent/shared/api/index.ts';
import type { DeviceLimits } from '../../agent/shared/state.ts';
import { HelperProcess } from '../src/helper/helper-process.ts';
import { DeviceActionRunner, TabActionError, type TabActionPort } from '../src/node/action-runner.ts';
import { DeviceGuard } from '../src/node/device-guard.ts';
import { realPathSystem } from '../src/node/path-policy.ts';
import { spawnFakeHelper, tempDir } from './helpers.ts';

const allow = { mode: 'allow' as const, perHour: 100 };
const LIMITS: DeviceLimits = { roots: [], apps: [], sites: [], unattendedInput: true,
  classes: { read: allow, write: allow, delete: { mode: 'confirm_each', perHour: 100 }, command: allow, browser: allow,
    input: allow } };

function wire(kind: string, params: Record<string, unknown>, deadline = '2099-01-01T00:00:00.000Z'): NodeWireAction {
  return { id: `a-${kind}`, kind: kind as NodeWireAction['kind'], params, deadline };
}

function runner(t: { after(fn: () => void): void }, options: { tabs?: TabActionPort; confirm?: boolean } = {}) {
  const dir = realpathSync(tempDir(t));
  const helper = new HelperProcess({ spawn: () => spawnFakeHelper(), roots: () => [dir], log: () => undefined });
  t.after(() => helper.stop());
  const asked: string[] = [];
  const tabs: TabActionPort = options.tabs ?? { available: () => true, run: async () => ({ tabs: [], viewing: null }) };
  const run = new DeviceActionRunner({ helper, tabs, guard: new DeviceGuard(), paths: realPathSystem('linux', dir),
    localRoots: () => [dir], confirm: async (message) => { asked.push(message); return options.confirm ?? false; },
    openExternal: async () => undefined, trash: async (path) => { rmSync(path); },
    readUrl: async () => ({ text: '', truncated: false }),
    now: () => new Date('2026-11-08T00:00:00.000Z'), log: () => undefined });
  return { run, dir, asked };
}

test('能力：助手报了的方法 + 网页标签 + 壳自己会的', async (t) => {
  const { run } = runner(t);
  const kinds = await run.capabilities();
  for (const kind of ['file_read', 'file_delete', 'run_command', 'screen_capture', 'tab_act', 'browser_open']) {
    assert.ok(kinds.includes(kind as never), kind);
  }
  assert.ok(!kinds.includes('input_click'));
  assert.ok(!kinds.includes('calendar_list'));
  assert.deepEqual(await run.missing(), ['accessibility', 'calendar', 'reminders']);
});

test('读文件：UTF-8 原样、版本是字节摘要；授权目录外拒', async (t) => {
  const { run, dir } = runner(t);
  writeFileSync(join(dir, 'a.txt'), '中文');
  const read = await run.execute(wire('file_read', { path: join(dir, 'a.txt') }), LIMITS);
  assert.equal(read.status, 'executed');
  assert.equal(read.result?.content, '中文');
  assert.equal(read.result?.encoding, 'utf8');
  const outside = await run.execute(wire('file_read', { path: '/etc/hostname' }), LIMITS);
  assert.equal(outside.status, 'refused');
  assert.equal(outside.refusalLayer, 'device');
});

test('删除每次问；他点不做就拒、文件还在，点做才挪走', async (t) => {
  const { run, dir, asked } = runner(t);
  writeFileSync(join(dir, 'b.txt'), 'x');
  const result = await run.execute(wire('file_delete', { path: join(dir, 'b.txt') }), LIMITS);
  assert.equal(result.status, 'refused');
  assert.equal(asked.length, 1);
  assert.ok(existsSync(join(dir, 'b.txt')));
  const yes = runner(t, { confirm: true });
  writeFileSync(join(yes.dir, 'c.txt'), 'x');
  const deleted = await yes.run.execute(wire('file_delete', { path: join(yes.dir, 'c.txt') }), LIMITS);
  assert.equal(deleted.status, 'executed', deleted.error);
  assert.ok(!existsSync(join(yes.dir, 'c.txt')));
});

test('助手报截图过期原样回失败种类；截屏回执就是设备动作的形状', async (t) => {
  const { run } = runner(t);
  const stale = await run.execute(wire('input_click', { x: 1, y: 1 }), LIMITS);
  assert.equal(stale.errorCode, 'screenshot_stale');
  const shot = await run.execute(wire('screen_capture', {}), LIMITS);
  assert.equal(shot.status, 'executed');
  assert.equal(shot.result?.width, 1);
  assert.equal((await run.execute(wire('input_click', { x: 0, y: 0 }), LIMITS)).status, 'executed');
});

test('参数不全、过了期限、网页标签报的失败种类都原样回', async (t) => {
  const tabs: TabActionPort = { available: () => true, run: async () => {
    throw new TabActionError('user_present', '你正看着这个标签，等你停下来再点。');
  } };
  const { run } = runner(t, { tabs });
  assert.equal((await run.execute(wire('file_read', {}), LIMITS)).status, 'refused');
  assert.match((await run.execute(wire('tab_list', {}, '2000-01-01T00:00:00.000Z'), LIMITS)).error ?? '', /期限/);
  const busy = await run.execute(wire('tab_click', { tabId: 't1', selector: '#a', text: null }), LIMITS);
  assert.equal(busy.status, 'failed');
  assert.equal(busy.errorCode, 'user_present');
});

test('结果形状不对按待核实报，不当做成了', async (t) => {
  const tabs: TabActionPort = { available: () => true, run: async () => ({ nope: true }) };
  const { run } = runner(t, { tabs });
  const result = await run.execute(wire('tab_list', {}), LIMITS);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /待核实/);
});
