import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { NodeWireAction } from '../../agent/shared/api/index.ts';
import type { DeviceLimits } from '../../agent/shared/state.ts';
import { HelperProcess } from '../src/helper/helper-process.ts';
import type { DeskPort } from '../src/node/desk-actions.ts';
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

function runner(t: { after(fn: () => void): void },
  options: { tabs?: TabActionPort; confirm?: boolean; limitMs?: number } = {}) {
  const dir = realpathSync(tempDir(t));
  const helper = new HelperProcess({ spawn: () => spawnFakeHelper(), roots: () => [dir], log: () => undefined });
  t.after(() => helper.stop());
  const asked: string[] = [];
  const clipped: string[] = [];
  const roots: string[] = [];
  const opened: string[] = [];
  const tabs: TabActionPort = options.tabs ?? { available: () => true, run: async () => ({ tabs: [], viewing: null }) };
  const desk: DeskPort = { state: () => ({ idleSeconds: 42, locked: false, onBattery: true, keptAwake: true }),
    clipboardRead: async () => ({ text: '剪贴板里的字', html: null }), clipboardWrite: async (text) => {
      clipped.push(text);
    }, chooseFolder: async () => dir, addRoot: (path) => {
      roots.push(path);
    }, open: async (target) => {
      opened.push(target);
    } };
  const run = new DeviceActionRunner({ helper, tabs, guard: new DeviceGuard(), paths: realPathSystem('linux', dir),
    desk, localRoots: () => [dir], confirm: async (message) => {
      asked.push(message);
      return options.confirm ?? false;
    },
    openExternal: async () => undefined, trash: async (path) => { rmSync(path); },
    readUrl: async () => ({ text: '', truncated: false }),
    now: () => new Date('2026-11-08T00:00:00.000Z'), log: () => undefined,
    ...(options.limitMs === undefined ? {} : { limitMs: () => options.limitMs! }) });
  return { run, dir, asked, clipped, roots, opened };
}

test('aggregates capabilities from helper methods, web tabs, and shell built-ins', async (t) => {
  const { run } = runner(t);
  const kinds = await run.capabilities();
  for (const kind of ['file_read', 'file_delete', 'run_command', 'screen_capture', 'tab_act', 'browser_open']) {
    assert.ok(kinds.includes(kind as never), kind);
  }
  assert.ok(!kinds.includes('input_click'));
  assert.ok(!kinds.includes('calendar_list'));
  assert.deepEqual(await run.missing(), ['accessibility', 'calendar', 'reminders']);
});

test('reads UTF-8 file verbatim with byte-hash version and rejects paths outside authorized folders', async (t) => {
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

test('transfers base64 files, requires overwrite sending old to trash, rejects unauthorized paths', async (t) => {
  const { run, dir } = runner(t);
  const picture = Buffer.from('89504e470d0a1a0a', 'hex');
  writeFileSync(join(dir, '图.png'), picture);
  const fetched = await run.execute(wire('file_fetch', { path: join(dir, '图.png') }), LIMITS);
  assert.equal(fetched.status, 'executed');
  assert.equal(fetched.result?.base64, picture.toString('base64'));
  assert.equal(fetched.result?.name, '图.png');
  const put = await run.execute(wire('file_put', { path: join(dir, '表.csv'), base64: Buffer.from('a,b\n')
    .toString('base64'), overwrite: false }), LIMITS);
  assert.equal(put.status, 'executed');
  assert.equal(readFileSync(join(dir, '表.csv'), 'utf8'), 'a,b\n');
  const again = await run.execute(wire('file_put', { path: join(dir, '表.csv'), base64: Buffer.from('c\n')
    .toString('base64'), overwrite: false }), LIMITS);
  assert.equal(again.status, 'failed');
  assert.match(String(again.error), /overwrite/);
  const replaced = await run.execute(wire('file_put', { path: join(dir, '表.csv'), base64: Buffer.from('c\n')
    .toString('base64'), overwrite: true }), LIMITS);
  assert.equal(replaced.status, 'executed');
  assert.equal(readFileSync(join(dir, '表.csv'), 'utf8'), 'c\n');
  const outside = await run.execute(wire('file_fetch', { path: '/etc/hostname' }), LIMITS);
  assert.equal(outside.status, 'refused');
  const kinds = await run.capabilities();
  assert.ok(kinds.includes('file_fetch') && kinds.includes('file_put') && kinds.includes('tab_upload'));
});

test('prompts on every delete, keeping file on decline and moving it only on confirm', async (t) => {
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

test('forwards helper expired-screenshot failure kind and shapes screenshot receipt as device action', async (t) => {
  const { run } = runner(t);
  const stale = await run.execute(wire('input_click', { x: 1, y: 1 }), LIMITS);
  assert.equal(stale.errorCode, 'screenshot_stale');
  const shot = await run.execute(wire('screen_capture', {}), LIMITS);
  assert.equal(shot.status, 'executed');
  assert.equal(shot.result?.width, 1);
  assert.equal((await run.execute(wire('input_click', { x: 0, y: 0 }), LIMITS)).status, 'executed');
});

test('preserves failure kinds for missing params, expired deadline, and web tab errors', async (t) => {
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

test('reports malformed result shape as pending verification instead of success', async (t) => {
  const tabs: TabActionPort = { available: () => true, run: async () => ({ nope: true }) };
  const { run } = runner(t, { tabs });
  const result = await run.execute(wire('tab_list', {}), LIMITS);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /待核实/);
});

test('abandons timed-out action reporting stuck step; read-only retries directly, click verifies', async (t) => {
  const tabs: TabActionPort = { available: () => true, run: (_action, step) => {
    step?.('截标签画面');
    return new Promise(() => undefined);
  } };
  const { run } = runner(t, { tabs, limitMs: 30 });
  const steps: string[] = [];
  const shot = await run.execute(wire('tab_shot', { tabId: 't-1' }), LIMITS, (step) => steps.push(step));
  assert.equal(shot.status, 'failed');
  assert.equal(shot.errorCode, 'timed_out');
  assert.equal(shot.timedOut?.step, '截标签画面');
  assert.equal(shot.timedOut?.retryable, true);
  assert.deepEqual(steps, ['开始做', '截标签画面']);
  const point = await run.execute(wire('tab_point', { tabId: 't-1', x: 1, y: 1 }), LIMITS);
  assert.equal(point.errorCode, 'timed_out');
  assert.equal(point.timedOut?.retryable, false);
  assert.match(point.error ?? '', /先核实/);
});

test('abandons canceled action and reports canceled receipt', async (t) => {
  const tabs: TabActionPort = { available: () => true, run: () => new Promise(() => undefined) };
  const { run } = runner(t, { tabs, limitMs: 60_000 });
  const cancel = new AbortController();
  const pending = run.execute(wire('tab_shot', { tabId: 't-1' }), LIMITS, undefined, cancel.signal);
  cancel.abort();
  const result = await pending;
  assert.equal(result.errorCode, 'cancelled');
});

test('shell handles local status, clipboard, folder picker authorization, file search, and app open', async (t) => {
  const { run, dir, clipped, roots, opened } = runner(t);
  writeFileSync(join(dir, '示例简历.pdf'), '%PDF');
  const state = await run.execute(wire('device_state', {}), LIMITS);
  assert.deepEqual(state, { status: 'executed', result: { idleSeconds: 42, locked: false, onBattery: true,
    keptAwake: true } });
  assert.equal((await run.execute(wire('clipboard_write', { text: '复制给你', html: null }), LIMITS)).status,
    'executed');
  assert.deepEqual(clipped, ['复制给你']);
  const folder = await run.execute(wire('folder_request', { reason: '要读你的简历文件夹' }), LIMITS);
  assert.deepEqual(folder, { status: 'executed', result: { path: dir } });
  assert.deepEqual(roots, [dir]);
  const found = await run.execute(wire('file_find', { root: dir, name: '简历', limit: 10 }), LIMITS);
  assert.equal(found.status, 'executed');
  assert.deepEqual((found.result as { matches: { path: string }[] }).matches.map((match) => match.path),
    [join(dir, '示例简历.pdf')]);
  await run.execute(wire('open_in_app', { target: join(dir, '示例简历.pdf'), app: null }), LIMITS);
  await run.execute(wire('open_in_app', { target: 'https://example.com', app: null }), LIMITS);
  assert.deepEqual(opened, [join(dir, '示例简历.pdf'), 'https://example.com']);
  const outside = await run.execute(wire('open_in_app', { target: '/etc/hosts', app: null }), LIMITS);
  assert.equal(outside.status, 'refused');
  const script = await run.execute(wire('app_script', { script: 'return 1' }), LIMITS);
  assert.equal(script.status, 'failed');
});
