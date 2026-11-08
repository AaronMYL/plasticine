// 工作详情不依赖对话最后一页：任务要求、核验后的原话、续写结果和返工历史各有真实来源。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { lineDetails } from '../../src/lines/details.ts';
import { startKernel } from './helpers.ts';

test('工作跑过很多步后仍读得到最初要求，模型委派不能冒充本人原话', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    const line = state.lines.create({ kind: 'background', parentLineId: null, projectId: null, title: '调研' });
    state.lineMessages.append(line.id, 'user', { role: 'user', content: '模型整理的任务目标', timestamp: 1 },
      { origin: { kind: 'delegation' } });
    for (let n = 0; n < 60; n += 1) {
      state.lineMessages.append(line.id, 'assistant', fauxAssistantMessage(`过程 ${n}`, { stopReason: 'toolUse' }));
    }
    const details = lineDetails(state, h.kernel.view(line.id));
    assert.equal(details.request?.text, '模型整理的任务目标');
    assert.equal(details.request?.source, null);
    assert.deepEqual(details.results, []);
  } finally {
    await h.close();
  }
});

test('查看原话只沿核验的引用返回本人输入，拼入的引用材料不算本人逐字请求', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    const main = h.kernel.view('main');
    const source = state.lineMessages.append(main.id, 'user',
      { role: 'user', content: '> 外部材料\n\n请查一下', timestamp: 1 },
      { origin: { kind: 'user', userText: '请查一下' } });
    const line = state.lines.create({ kind: 'background', parentLineId: main.id, projectId: null, title: '调研' });
    state.lineMessages.append(line.id, 'user', { role: 'user', content: '完整任务目标', timestamp: 2 },
      { origin: { kind: 'delegation', ref: `line:${main.id}:${source.seq}` } });
    assert.deepEqual(lineDetails(state, h.kernel.view(line.id)).request?.source,
      { lineId: main.id, seq: source.seq, text: '请查一下' });
    const unknown = state.lines.create({ kind: 'background', parentLineId: main.id, projectId: null, title: '旧线' });
    state.lineMessages.append(unknown.id, 'user', { role: 'user', content: '角色叫 user 的旧内容', timestamp: 3 });
    assert.equal(lineDetails(state, h.kernel.view(unknown.id)).request?.source, null);
  } finally {
    await h.close();
  }
});

test('多段续写在成果历史里是一版；明确返工另存一版，翻页不重复续写片段', async () => {
  const h = await startKernel();
  try {
    h.respond([fauxAssistantMessage('第一段。\n\n', { stopReason: 'length' })]);
    const line = h.kernel.open({ title: '调研结果', goal: '完整分析', projectId: null, parentLineId: null });
    await h.kernel.settled();
    h.respond([fauxAssistantMessage('结论。')]);
    h.kernel.retry(line.id);
    await h.kernel.settled();
    h.respond([fauxAssistantMessage('新要求下的完整第二稿。')]);
    h.kernel.send(line.id, { text: '请换个角度重写', origin: { kind: 'user' } });
    await h.kernel.settled();
    const first = lineDetails(h.handle.state, h.kernel.view(line.id), { limit: 1 });
    assert.equal(first.results[0]?.text, '新要求下的完整第二稿。');
    assert.equal(first.hasMore, true);
    const second = lineDetails(h.handle.state, h.kernel.view(line.id), { limit: 1, before: first.nextBefore! });
    assert.equal(second.results[0]?.text, '第一段。\n\n结论。');
    assert.equal(second.results[0]?.complete, true);
    assert.equal(second.hasMore, false);
  } finally {
    await h.close();
  }
});
