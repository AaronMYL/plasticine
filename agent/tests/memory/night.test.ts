import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Dreamer, DreamInput, DreamReport } from '../../src/memory/index.ts';
import { DreamNight } from '../../src/memory/dream/night.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function night(results: (DreamReport | Error)[]) {
  const calls: DreamInput[] = [];
  const fake = {
    async dream(input: DreamInput): Promise<DreamReport> {
      calls.push(input);
      const next = results.shift() ?? { dream: null, skipped: true, changes: 0, docIds: [], rejected: 0 };
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  } as unknown as Dreamer;
  const clock = { at: new Date('2026-11-07T22:00:00+08:00') };
  const desk = new DreamNight({ state: t.state, dreamer: () => fake, now: () => clock.at,
    zone: () => 'Asia/Shanghai' });
  return { desk, calls, clock };
}

const done = (changes: number): DreamReport => ({ dream: null, skipped: false, changes, docIds: [], rejected: 0 });

test('Runs nightly at 1am, logs count; failed night resumes from same cursor next night', async () => {
  const { desk, calls, clock } = night([new Error('模型超时'), done(11)]);
  desk.tick(clock.at);
  assert.equal(desk.row().nextAt, new Date('2026-11-08T01:00:00+08:00').toISOString());
  assert.equal(desk.row().canRemove, false);
  clock.at = new Date('2026-11-08T01:00:00+08:00');
  desk.tick(clock.at);
  await desk.settled();
  assert.equal(desk.row().last?.glyph, 'err');
  const firstFrom = calls[0]?.from;
  clock.at = new Date('2026-11-09T01:00:00+08:00');
  desk.tick(clock.at);
  await desk.settled();
  assert.equal(calls[1]?.from, firstFrom, '失败那一晚的那段下一晚补上');
  assert.equal(desk.row().last?.text, '整理了 11 条');
  assert.equal(calls[1]?.fixSummaries, true);
  clock.at = new Date('2026-11-10T01:00:00+08:00');
  desk.tick(clock.at);
  await desk.settled();
  assert.equal(calls[2]?.from, new Date('2026-11-09T01:00:00+08:00').toISOString());
  assert.equal(calls[2]?.fixSummaries, false, '旧简介只在第一次整理时改');
  assert.equal(desk.row().last?.text, '没有新对话，跳过');
});

test('Delays 10 min if 3 background lines are busy; skips when disabled', async () => {
  const { desk, calls, clock } = night([done(1)]);
  desk.tick(clock.at);
  for (let index = 0; index < 3; index += 1) {
    const line = t.state.lines.create({ kind: 'background', parentLineId: null, projectId: null, title: `线 ${index}` });
    t.state.lines.update(line.id, { status: 'running' });
  }
  clock.at = new Date('2026-11-08T01:00:00+08:00');
  desk.tick(clock.at);
  assert.equal(calls.length, 0);
  assert.equal(desk.row().nextAt, new Date('2026-11-08T01:10:00+08:00').toISOString());
  desk.setEnabled(false);
  assert.equal(desk.row().nextAt, null);
});
