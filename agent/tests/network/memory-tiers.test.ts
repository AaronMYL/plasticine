// 记忆档位（《优化清单》第 19 条，11-06 定）：每篇带档位，默认私密；别人 @ 他的 AI 时只读对方档位能看的那几篇，
// 群聊按群里最低那一档；归档和「今天的记录」一律不对外。技能也是默认私密、不建议公开。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { addLine, ensureMemoryDocs } from '../../src/brain/index.ts';
import { gatherMaterials, suggestTier } from '../../src/network/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const writer = { actor: 'brain' as const, ref: 'job-1' };
const anchors = [{ kind: 'message' as const, ref: 'line:main:1' }];

test('对外只给确认过、够得着的那几篇的现行行；归档的旧说法、今天的记录、没定档的都不给', () => {
  const { state } = t;
  ensureMemoryDocs(state);
  const topic = state.memoryDocs.docs.create({ kind: 'topic', title: '研究周报', summary: '偏基础研究',
    createdBy: 'brain' });
  const skill = state.memoryDocs.docs.create({ kind: 'skill', title: '视频解析', summary: '先用自带字幕',
    createdBy: 'brain' });
  addLine(state, { docId: topic.id, text: '偏基础研究、偏专业', basis: 'stated', anchors }, writer);
  const old = addLine(state, { docId: topic.id, text: '旧说法：要科普口吻', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.retire(old.id, old.version, 'revised');
  addLine(state, { docId: skill.id, text: '没有字幕再本地转写', basis: 'stated', anchors }, writer);
  state.memoryJournal.add({ day: '2026-11-07', kind: 'fact', text: '今天的记录：周报要加图', anchors,
    writtenBy: 'brain' });
  state.visibilityMarks.put('memory_topic', topic.id, 0, { tier: 'friend', proposed: null, confirmed: true });

  assert.equal(suggestTier({ kind: 'memory_topic', doc: skill }), null, '技能默认私密，不建议');
  assert.deepEqual(gatherMaterials(state, ['public']), [], '陌生人够不着朋友档');
  const friend = gatherMaterials(state, ['public', 'partner', 'friend']);
  assert.deepEqual(friend.map((material) => material.id), [topic.id]);
  assert.equal(friend[0]?.text, '偏基础研究、偏专业');
  const all = JSON.stringify(friend);
  assert.doesNotMatch(all, /旧说法/);
  assert.doesNotMatch(all, /今天的记录/);
  assert.doesNotMatch(all, /本地转写/);
});
