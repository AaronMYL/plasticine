import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { ProjectWatch, STALL_DAYS } from '../../src/attention/project-watch.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openState, type StateService } from '../../src/state/index.ts';

const DAY_MS = 86_400_000;

// 状态库和查看用同一个时钟，测试里拨它就是「过了几天」。
let t: { state: StateService; directory: string };
let clock: Date;
let changed: string[];

beforeEach(async () => {
  clock = new Date('2026-11-01T04:00:00.000Z');
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-watch-'));
  t = { state: openState({ path: join(directory, 'plasticine.sqlite'), now: () => clock.toISOString() }), directory };
  changed = [];
});

afterEach(async () => {
  t.state.close();
  await rm(t.directory, { recursive: true, force: true });
});

function watch(): ProjectWatch {
  return new ProjectWatch({ state: t.state, timeZone: 'Asia/Shanghai', now: () => clock,
    changed: (id) => changed.push(id) });
}

test('刚建的项目不写每周现状；满一周写一条，同一周不重复写', async () => {
  const project = t.state.projects.create({ name: 'Cyber Hunter' });
  clock = new Date(clock.getTime() + DAY_MS);
  const w = watch();
  assert.equal((await w.scan()).weekly, 0);
  assert.deepEqual(changed, []);
  clock = new Date(clock.getTime() + 8 * DAY_MS);
  assert.equal((await w.scan()).weekly, 1);
  assert.equal((await w.scan()).weekly, 0);
  assert.deepEqual(changed, [project.id]);
  const event = t.state.projects.events.recent(project.id, 1)[0];
  assert.equal(event?.kind, 'weekly');
  assert.equal(event?.actor, 'system');
  assert.match(event?.text ?? '', /每周现状：待办 0 \/ 0 · 在做 0 条线/);
});

test('逾期、停滞不再自己发通知（并进心跳，11-06 定）：只数出来，停滞的给心跳读', async () => {
  t.state.projects.create({ name: '资料交接', due: '2026-10-30' });
  t.state.projects.create({ name: '还没到期', due: '2026-12-01' });
  const quiet = t.state.projects.create({ name: '搁着的' });
  t.state.projects.create({ name: '常驻', standing: true });
  t.state.projects.create({ name: '暂停的', lifecycle: 'paused' });
  clock = new Date(clock.getTime() + (STALL_DAYS + 1) * DAY_MS);
  const w = watch();
  const report = await w.scan();
  assert.equal(report.overdue, 1);
  assert.deepEqual(w.stalled(clock).map((project) => project.id).includes(quiet.id), true);
  assert.deepEqual(w.stalled(clock).map((project) => project.name).sort(), ['搁着的', '资料交接', '还没到期'].sort());
});
