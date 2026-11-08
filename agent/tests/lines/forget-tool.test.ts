// 他说「忘掉 X」（《优化清单》第 16 条，11-06 定）：现行和归档里的都删，删前出卡确认一次（硬线里的「删除」，撤不回）。
// 同意了：那几行真的从库里删掉（11-07 他定），今天记录里讲同一件事的也删；没同意：一行不动。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { YOU_DOC_ID } from '../../shared/state.ts';
import { addLine, ensureMemoryDocs } from '../../src/brain/index.ts';
import { forgetTool } from '../../src/lines/index.ts';
import { openTestState } from '../state/helpers.ts';
import { startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

async function harness(): Promise<Harness> {
  const handle = await openTestState();
  const started = await startKernel({ handle, tools: [forgetTool(handle.state)] });
  open.push(started);
  return started;
}

test('忘掉：先出卡说清撤不回；同意后现行和归档里的那几行、今天记录里同一件事一起删', async () => {
  const h = await harness();
  const { state } = h.handle;
  ensureMemoryDocs(state);
  const writer = { actor: 'brain' as const, ref: 'earlier' };
  const anchors = [{ kind: 'message' as const, ref: 'line:main:1' }];
  const current = addLine(state, { docId: YOU_DOC_ID, text: '以前的猫叫小周', basis: 'stated', anchors }, writer);
  const old = addLine(state, { docId: YOU_DOC_ID, text: '和小周住在一起', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.retire(old.id, old.version, 'no_longer_true');
  const kept = addLine(state, { docId: YOU_DOC_ID, text: '住在杭州', basis: 'stated', anchors }, writer);
  state.memoryJournal.add({ day: '2026-11-07', kind: 'fact', text: '以前的猫叫小周', anchors, writtenBy: 'brain' });

  h.respond([
    fauxAssistantMessage([fauxToolCall('forget', { lineIds: [current.id, old.id], what: '小周的事' },
      { id: 'forget-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('忘掉了。'),
  ]);
  h.kernel.send('main', { text: '小周的事都忘掉吧' });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  const ask = state.asks.open()[0];
  assert.ok(ask !== undefined);
  assert.equal(ask.basis, 'hard_line');
  assert.match(ask.question, /忘掉/);
  assert.match(ask.detail ?? '', /撤不回/);
  assert.equal(state.memoryDocs.lines.live(YOU_DOC_ID).length, 2, '没同意之前一行不动');

  h.desk.answer({ askId: ask.id, optionId: 'allow', answerer: { deviceId: 'device-1' } });
  await h.kernel.settled();
  assert.deepEqual(state.memoryDocs.lines.live(YOU_DOC_ID).map((line) => line.id), [kept.id]);
  assert.deepEqual(state.memoryDocs.lines.archived(YOU_DOC_ID), []);
  assert.equal(state.memoryDocs.lines.get(old.id), undefined, '真的从库里删了');
  assert.equal(state.memoryDocs.lines.get(current.id), undefined);
  assert.deepEqual(state.memoryJournal.open(), []);
});

test('忘掉的行对不上（没有或已经删过）：工具报错，不出卡以外的任何改动', async () => {
  const h = await harness();
  const { state } = h.handle;
  ensureMemoryDocs(state);
  const tool = forgetTool(state).create({ lineId: 'main', kind: 'main', projectId: null });
  await assert.rejects(() => tool.execute('call-1', { lineIds: ['no-such-line'], what: '不存在的' }),
    /找不到/);
});
