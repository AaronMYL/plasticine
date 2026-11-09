// 「到点要做什么」（第 6、7 条）：放进订阅自己那条后台线的消息、第一次开线以后往同一条线里放、回顾的材料和边界。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { DEFAULT_REVIEW, ensureReviewSubscription, researchDraft, reviewMaterials, runSubscription,
  type RunPort } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function port(): RunPort & { opened: string[]; told: [string, string][] } {
  const opened: string[] = [];
  const told: [string, string][] = [];
  return {
    opened,
    told,
    open(input) {
      opened.push(`${input.title}|${input.purpose}|${input.origin.ref ?? ''}`);
      return `line-${opened.length}`;
    },
    tell(lineId, text) {
      told.push([lineId, text]);
      return lineId !== 'line-gone';
    },
  };
}

test('研究周报：第一次开一条后台线（researcher 模型），以后往同一条线里放消息；消息里有设置、结构和长期规则', () => {
  const settings = { ...researchDraft({ topics: ['记忆巩固', '睡眠'], focus: 'basic', depth: 'expert' }),
    rules: [{ text: '每期最多 1 张图', fromIssue: 2, addedAt: '2026-11-07T00:00:00.000Z' }] };
  const sub = t.state.subscriptions.create({ title: '认知与神经科学研究周报', kind: 'research', status: 'active',
    timeZone: 'Asia/Shanghai', settings });
  const lines = port();
  const first = runSubscription(t.state, lines, sub.id, new Date('2026-11-09T01:00:00Z'));
  assert.deepEqual(lines.opened, [`认知与神经科学研究周报|researcher|subscription:${sub.id}`]);
  assert.match(first.run.message, /第 1 期/);
  assert.match(first.run.message, /记忆巩固、睡眠/);
  assert.match(first.run.message, /偏基础研究；写给专业读者；收预印本，但标出来/);
  assert.match(first.run.message, /1\. 本周概览 2\. 重点研究/);
  assert.match(first.run.message, /- 每期最多 1 张图/);
  assert.match(first.run.message, /space_write/);
  assert.match(first.run.message, /genre 填 report/);
  const saved = t.state.subscriptions.require(sub.id);
  assert.equal(saved.lineId, 'line-1');
  assert.equal(saved.lastRunAt, '2026-11-09T01:00:00.000Z');
  runSubscription(t.state, lines, sub.id, new Date('2026-11-16T01:00:00Z'));
  assert.equal(lines.opened.length, 1);
  assert.equal(lines.told[0]?.[0], 'line-1');
});

test('订阅的线不在了：另开一条', () => {
  const sub = t.state.subscriptions.create({ title: '周报', kind: 'research', status: 'active',
    timeZone: 'Asia/Shanghai', settings: researchDraft({}) });
  t.state.subscriptions.update(sub.id, sub.version, { lineId: 'line-gone' });
  const lines = port();
  assert.equal(runSubscription(t.state, lines, sub.id, new Date('2026-11-09T01:00:00Z')).lineId, 'line-1');
});

function journal(day: string, text: string, docId: string | null, lineId = 'line-main') {
  t.state.memoryJournal.add({ day, kind: 'decision', text, anchors: [{ kind: 'message', ref: `line:${lineId}:3` }],
    docId, writtenBy: 'brain' });
}

test('回顾的材料：今天的记录带出处、不参考的对话不进来；交流里的话题要不同的几天反复出现才算兴趣', () => {
  const doc = t.state.memoryDocs.docs.create({ kind: 'topic', title: '侧栏方案', summary: '', createdBy: 'brain' });
  journal('2026-11-06', '侧栏方案定稿', doc.id);
  journal('2026-11-05', '侧栏先做两层', doc.id);
  journal('2026-11-06', '旁聊里随口说的', null, 'line-side');
  const settings = { ...DEFAULT_REVIEW, topics: ['睡眠'],
    exclude: [{ kind: 'line' as const, id: 'line-side', label: '旁聊' }] };
  const materials = reviewMaterials(t.state, settings, 'daily', new Date('2026-11-07T00:00:00Z'), 'Asia/Shanghai');
  assert.equal(materials.from, '2026-11-06');
  assert.equal(materials.to, '2026-11-07');
  assert.deepEqual(materials.entries.map((entry) => [entry.text, entry.links]), [
    ['侧栏方案定稿', [{ kind: 'message', id: 'line:line-main:3' }]],
  ]);
  assert.deepEqual(materials.interests.map((item) => [item.label, item.why]), [['睡眠', 'explicit'],
    ['侧栏方案', 'talk']]);
  assert.equal(materials.dream, null);
});

test('回顾写成来信：日报写昨天的进展和没解决的、没价值就跳过、只读；没有昨晚的整理就不提；周报长一点', () => {
  const review = ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const lines = port();
  const { run } = runSubscription(t.state, lines, review.id, new Date('2026-11-07T00:00:00Z'), 'daily');
  assert.equal(run.purpose, 'review');
  assert.match(run.message, /每日来信/);
  assert.match(run.message, /昨天的进展、没解决的问题/);
  assert.match(run.message, /不调 space_write/);
  assert.match(run.message, /genre 填 letter/);
  assert.match(run.message, /say 写在主线里/);
  assert.match(run.message, /data-illustrate/);
  assert.match(run.message, /不改项目状态、不建任务、不对外发消息/);
  assert.match(run.message, /不提「昨晚整理了什么」/);
  assert.match(run.message, /edition 填 daily/);
  const weekly = runSubscription(t.state, lines, review.id, new Date('2026-11-08T13:00:00Z'), 'weekly').run;
  assert.match(weekly.message, /每周来信/);
  assert.match(weekly.message, /跨天的变化、反复出现的主题、项目之间的联系/);
});

test('回顾的材料：一天之内做完的整理算「昨晚整理」，撤销了的那条不算', () => {
  const dream = t.state.memoryDreams.create({ startedAt: '2026-11-06T18:00:00.000Z', linesRead: 2,
    conversationsRead: 3 });
  t.state.memoryDreams.finish(dream.id, dream.version);
  const anchors = [{ kind: 'message' as const, ref: 'line:line-main:1' }];
  t.state.memoryDreams.addChange({ dreamId: dream.id, kind: 'add', text: '新加的一条', anchors });
  const undone = t.state.memoryDreams.addChange({ dreamId: dream.id, kind: 'add', text: '撤销的一条', anchors });
  t.state.memoryDreams.updateChange(undone.id, undone.version, { undoneAt: '2026-10-27T09:00:00.000Z' });
  const at = new Date(Date.parse(t.state.memoryDreams.latest()?.finishedAt ?? '') + 60_000);
  const materials = reviewMaterials(t.state, DEFAULT_REVIEW, 'daily', at, 'Asia/Shanghai');
  assert.equal(materials.dream?.total, 1);
  assert.equal(materials.dream?.add, 1);
});
