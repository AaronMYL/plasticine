import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { feedItemView } from '../../src/app/daily-views.ts';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

test('纠正信息流归类时来源和主题一致，原文与用户操作保留且旧版本不能覆盖', () => {
  const wrong = t.state.feedSources.create({ kind: 'interest', label: '效率工具' });
  const right = t.state.feedSources.create({ kind: 'interest', label: '宏观投资' });
  const { item } = t.state.feedItems.add({
    sourceId: wrong.id, origin: 'feed', title: '政策性金融工具投放', url: 'https://example.com/policy',
    summary: '政策资金已经投放。', why: '与宏观投资关注相关。', topic: wrong.label,
    dedupeKey: 'policy-attribution', day: '2026-10-27',
    arrivedAt: '2026-10-27T08:00:00.000Z',
  });
  const saved = t.state.feedItems.update(item.id, item.version, {
    reaction: 'like', note: '稍后看', savedAt: '2026-10-27T08:01:00.000Z', seenAt: '2026-10-27T08:01:00.000Z',
  });
  const updated = t.state.feedItems.update(saved.id, saved.version, {
    sourceId: right.id, topic: right.label,
  });
  assert.deepEqual(updated, { ...saved, sourceId: right.id, topic: right.label,
    updatedAt: updated.updatedAt, version: saved.version + 1 });
  const view = feedItemView(t.state, updated, null);
  assert.equal(view.sourceLabel, right.label);
  assert.equal(view.topic, right.label);
  throwsState(() => t.state.feedItems.update(saved.id, saved.version, { topic: wrong.label }), 'version_conflict');
});
