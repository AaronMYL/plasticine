import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

test('信息流条目：同一个 dedupe key 只有一条；不感兴趣的默认不在列表里、也不算新的', () => {
  const source = t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  assert.equal(t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '别的' }).id, source.id);
  const input = {
    sourceId: source.id,
    origin: 'manual' as const,
    title: '一篇文章',
    dedupeKey: 'manual:r1',
    day: '2026-10-27',
    arrivedAt: '2026-10-27T08:00:00.000Z',
  };
  const { item } = t.state.feedItems.add(input);
  assert.equal(t.state.feedItems.add({ ...input, title: '重放' }).created, false);
  assert.equal(t.state.feedItems.countArrivedSince('2026-10-27T00:00:00.000Z'), 1);
  t.state.feedItems.update(item.id, item.version, { reaction: 'dislike' });
  assert.deepEqual(t.state.feedItems.page({}, {}), []);
  assert.equal(t.state.feedItems.page({ includeHidden: true }, {}).length, 1);
  assert.equal(t.state.feedItems.countArrivedSince('2026-10-27T00:00:00.000Z'), 0);
});

test('每日设置：没存过是默认（十件事 20、回来 4 小时、采访关着）；改要带版本，过时报冲突不覆盖', () => {
  const initial = t.state.dailySettings.read();
  assert.equal(initial.version, 0);
  assert.deepEqual(initial.settings, {
    briefLimit: 20,
    returnThresholdHours: 4,
    interviewEnabled: false,
    interviewPerDay: 3,
  });
  const saved = t.state.dailySettings.save(0, { briefLimit: 30 });
  assert.equal(saved.version, 1);
  throwsState(() => t.state.dailySettings.save(0, { briefLimit: 5 }), 'version_conflict');
  assert.equal(t.state.dailySettings.read().settings.briefLimit, 30);
  throwsState(() => t.state.dailySettings.save(1, { briefLimit: 0 }), 'invalid_input');
  // The migration writes only into a library that has no settings yet.
  assert.equal(t.state.dailySettings.importOnce({ briefLimit: 10 }, { briefLimit: 10 }), false);
  assert.equal(t.state.dailySettings.read().settings.briefLimit, 30);
});
