import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { openTestState, type TestState } from './helpers.ts';

const opened: TestState[] = [];

async function fresh(): Promise<TestState> {
  const handle = await openTestState();
  opened.push(handle);
  return handle;
}

afterEach(async () => {
  for (const handle of opened.splice(0)) {
    await handle.cleanup();
  }
});

test('按天分段：一条线一天一行，最新的一天在前；要点写在那一天上，读前一天的要点', async () => {
  const { state } = await fresh();
  const line = state.lines.main();
  assert.equal(state.lineDays.latest(line.id), undefined);
  state.lineDays.start(line.id, '2026-11-06', 1);
  state.lineDays.start(line.id, '2026-11-07', 9);
  const latest = state.lineDays.latest(line.id);
  assert.equal(latest?.day, '2026-11-07');
  assert.equal(latest?.startSeq, 9);
  assert.equal(latest?.compactions, 0);
  assert.equal(latest?.summary, null);
  assert.equal(state.lineDays.previous(line.id, '2026-11-07')?.day, '2026-11-06');
  assert.equal(state.lineDays.previous(line.id, '2026-11-06'), undefined);
  assert.deepEqual(state.lineDays.undigested('2026-11-07').map((row) => row.day), ['2026-11-06'], '做梦从这里挑');
  state.lineDays.setDigest(line.id, '2026-11-06', '定了侧栏方案；悬赏还缺赏金来源');
  assert.equal(state.lineDays.previous(line.id, '2026-11-07')?.digest, '定了侧栏方案；悬赏还缺赏金来源');
  assert.deepEqual(state.lineDays.undigested('2026-11-07'), []);
});

test('当天压缩：摘要、压到第几条记在这一天上，次数加一；只挪窗口不加次数', async () => {
  const { state } = await fresh();
  const line = state.lines.main();
  state.lineDays.start(line.id, '2026-11-07', 3);
  state.lineDays.compacted(line.id, '2026-11-07', { summary: '摘要一', summarySeq: 10, counted: true });
  state.lineDays.compacted(line.id, '2026-11-07', { summary: '摘要一', summarySeq: 20, counted: false });
  const day = state.lineDays.latest(line.id);
  assert.equal(day?.summary, '摘要一');
  assert.equal(day?.summarySeq, 20);
  assert.equal(day?.compactions, 1);
});

test('旁聊是一种线：带话题建出来，列表按种类筛；后台线的结论记在线上', async () => {
  const { state } = await fresh();
  state.lines.main();
  const side = state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: '讨论：睡眠中的记忆重放',
    topic: { kind: 'feed', ref: 'feed_1', title: '睡眠中的记忆重放', source: 'bioRxiv', at: null, excerpt: '颅内电极' } });
  assert.equal(side.kind, 'side');
  assert.deepEqual(side.topic, { kind: 'feed', ref: 'feed_1', title: '睡眠中的记忆重放', source: 'bioRxiv', at: null,
    excerpt: '颅内电极' });
  assert.deepEqual(state.lines.list({ kind: 'side' }).map((line) => line.id), [side.id]);
  const work = state.lines.create({ kind: 'background', parentLineId: null, projectId: null, title: '查' });
  assert.equal(work.topic, null);
  assert.equal(state.lines.update(work.id, { conclusion: '查到了' }).conclusion, '查到了');
});

test('消息旁边的记录可以补一项（表情），别的项和消息原文不动', async () => {
  const { state } = await fresh();
  const line = state.lines.main();
  const row = state.lineMessages.append(line.id, 'assistant', { role: 'assistant', content: [] }, { thinkingMs: 900 });
  const patched = state.lineMessages.patchMeta(line.id, row.seq, { reactions: ['👍'] });
  assert.deepEqual(patched.meta, { thinkingMs: 900, reactions: ['👍'] });
  assert.deepEqual(patched.message, { role: 'assistant', content: [] });
});
