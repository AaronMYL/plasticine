// 给模型的「翻对话」（第 17 条）：按关键词、日期、线的种类查原话，返回引用、时间、所在线和前后一小段原文。只读。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { conversationSearchTool } from '../../src/lines/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function say(lineId: string, role: 'user' | 'assistant', text: string): string {
  const message = role === 'user' ? { role, content: text, timestamp: 0 }
    : { role, content: [{ type: 'text', text }], timestamp: 0 };
  return `line:${lineId}:${t.state.lineMessages.append(lineId, role, message).seq}`;
}

async function run(args: Record<string, unknown>): Promise<string> {
  const main = t.state.lines.main();
  const tool = conversationSearchTool(t.state).create({ lineId: main.id, kind: 'main', projectId: null });
  const result = await tool.execute('call-1', args);
  const part = result.content[0];
  assert.equal(part?.type, 'text');
  return part.type === 'text' ? part.text : '';
}

test('按关键词找原话：给出引用、时间、所在线和命中处前后的原文', async () => {
  const main = t.state.lines.main().id;
  const ref = say(main, 'user', '前面说了很多别的事情。'.repeat(20) + '我的护照号码下周要续签' + '后面还有'.repeat(30));
  const text = await run({ query: '护照' });
  assert.match(text, new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /主对话/);
  assert.match(text, /你/);
  assert.match(text, /护照号码下周要续签/);
  assert.match(text, /2026-10-27/);
  assert.ok(text.length < 600, '只给前后一小段，不是整条');
});

test('按线的种类和日期筛；没有命中时直说', async () => {
  const main = t.state.lines.main().id;
  const work = t.state.lines.create({ kind: 'background', parentLineId: main, projectId: null, title: '比价' }).id;
  say(main, 'user', '机票比价');
  const background = say(work, 'assistant', '机票比价结果出来了');
  const only = await run({ query: '机票比价', lineKind: 'background' });
  assert.match(only, new RegExp(background));
  assert.doesNotMatch(only, /line:line-main/);
  assert.match(await run({ query: '机票比价', from: '2026-10-28' }), /没找到/);
  assert.match(await run({ query: '机票比价', to: '2026-10-27' }), /line:line-main:1/);
  assert.match(await run({ query: '火车票' }), /没找到/);
});

test('参数不过 schema 时拒绝', async () => {
  await assert.rejects(() => run({ query: '' }));
  await assert.rejects(() => run({ query: '机票', from: '10/28' }));
});
