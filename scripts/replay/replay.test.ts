// 真模型回放的判法、挑法和一件怎么问（内核优化第三批）：不连网，用假的模型回答。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fauxAssistantMessage, fauxToolCall, type AssistantMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { calledTools, casesByRef, pickCases } from './cases.ts';
import { callName, familyOf, judge } from './families.ts';
import { replayCase, summarize, type ReplayModel } from './run.ts';

test('叫法：tool_call 拆开算里面那件，device_action 带上动作；同类的算 family', () => {
  assert.equal(callName('tool_call', { name: 'device_action', arguments: { action: { kind: 'tab_act' } } }),
    'device_action:tab_act');
  assert.equal(callName('read_line', { lineId: 'a' }), 'read_line');
  assert.equal(familyOf('device_action:tab_click'), familyOf('device_action:tab_perceive'));
  assert.equal(familyOf('list_lines'), familyOf('read_line'));
  assert.equal(judge(['read_line'], ['read_line']), 'exact');
  assert.equal(judge(['read_line', 'tell_line'], ['list_lines']), 'family');
  assert.equal(judge(['server_command'], ['web_search']), 'none');
  assert.equal(judge([], []), 'exact', '线上是直接答的，这次也直接答');
  assert.equal(judge(['read_line'], []), 'none');
});

function seed(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE lines (id TEXT PRIMARY KEY, kind TEXT, sealed_prompt TEXT);
    CREATE TABLE line_messages (line_id TEXT, seq INTEGER, role TEXT, message TEXT, meta TEXT, created_at TEXT)`);
  const lines = db.prepare('INSERT INTO lines VALUES (?, ?, ?)');
  lines.run('line-main', 'main', null);
  lines.run('line-bg', 'background', null);
  lines.run('line-sealed', 'background', 'sealed');
  const add = db.prepare('INSERT INTO line_messages VALUES (?, ?, ?, ?, ?, ?)');
  const call = (name: string, args: object) => JSON.stringify({ role: 'assistant',
    content: [{ type: 'toolCall', id: 'c', name, arguments: args }] });
  const said = JSON.stringify({ origin: { kind: 'user' } });
  let at = 0;
  const time = () => `2026-11-17T00:${String(at++).padStart(2, '0')}:00Z`;
  for (let round = 0; round < 4; round += 1) {
    add.run('line-main', round * 2 + 1, 'user', JSON.stringify({ role: 'user', content: '问' }), said, time());
    add.run('line-main', round * 2 + 2, 'assistant', call('read_line', { lineId: 'x' }), null, time());
  }
  add.run('line-main', 9, 'user', JSON.stringify({ role: 'user', content: '只答话' }), said, time());
  add.run('line-main', 10, 'assistant', JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: '好' }] }),
    null, time());
  add.run('line-bg', 1, 'user', JSON.stringify({ role: 'user', content: '做事' }), null, time());
  add.run('line-bg', 2, 'assistant', call('device_action', { action: { kind: 'tab_act' } }), null, time());
  add.run('line-sealed', 1, 'user', JSON.stringify({ role: 'user', content: '替人答' }), null, time());
  add.run('line-sealed', 2, 'assistant', call('read_line', {}), null, time());
  return db;
}

test('挑法：只挑紧接着调了工具的；替人答话的封闭线不挑；每条线有上限；照引用取回同一批', () => {
  const db = seed();
  const picked = pickCases(db, { count: 10, background: 4, perLine: 3 });
  assert.deepEqual(picked.map((item) => item.ref),
    ['line:line-bg:1', 'line:line-main:7', 'line:line-main:5', 'line:line-main:3']);
  assert.deepEqual(picked[0]?.expected, ['device_action:tab_act']);
  assert.deepEqual(casesByRef(db, ['line:line-main:3', 'line:line-gone:1', 'nonsense']).map((item) => item.ref),
    ['line:line-main:3']);
  assert.deepEqual(calledTools({ content: [{ type: 'text', text: 'x' }] }), []);
  db.close();
});

function scripted(answers: AssistantMessage[]): { model: ReplayModel; asked: number[] } {
  const asked: number[] = [];
  const model: ReplayModel = {
    model: {} as ReplayModel['model'],
    complete: async (context) => {
      asked.push(context.messages.length);
      const next = answers.shift();
      if (next === undefined) {
        throw new Error('剧本用完了');
      }
      return { ...next, usage: { ...next.usage, input: 1000, cacheRead: 500, output: 20 } };
    },
  };
  return { model, asked };
}

const searchTool = {
  name: 'tool_search', label: '找工具', description: '找', parameters: Type.Object({ query: Type.String() }),
  execute: async () => ({ content: [{ type: 'text' as const, text: 'read_line：读一条线' }], details: {} }),
};

test('一件：找工具照常执行再问，真正的第一次调用拿来判；token 记第一次和合计；不执行别的工具', async () => {
  const item = { ref: 'line:a:1', lineId: 'a', seq: 1, kind: 'main', expected: ['read_line'] };
  const { model, asked } = scripted([
    fauxAssistantMessage([fauxToolCall('tool_search', { query: '读线' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('tool_call', { name: 'read_line', arguments: { lineId: 'b' } })],
      { stopReason: 'toolUse' }),
  ]);
  const result = await replayCase(item, { prompt: '系统', tools: [searchTool] },
    { role: 'user', content: '问', timestamp: 1 }, model, AbortSignal.timeout(5_000));
  assert.deepEqual(result.got, ['read_line']);
  assert.equal(result.match, 'exact');
  assert.equal(result.asks, 2);
  assert.deepEqual(asked, [2, 4], '第二问带上找工具的调用和结果');
  assert.equal(result.firstPrompt, 1500);
  assert.equal(result.totalPrompt, 3000);
  const summary = summarize([result, { ...result, match: 'none' }, { ...result, error: '断了' }]);
  assert.deepEqual({ ...summary }, { cases: 3, exact: 1, family: 0, none: 1, errors: 1, avgFirstPrompt: 1500,
    avgTotalPrompt: 3000, avgAsks: 2 });
});

test('一件：模型出错记下原因，不当成判错', async () => {
  const item = { ref: 'line:a:1', lineId: 'a', seq: 1, kind: 'main', expected: ['read_line'] };
  const { model } = scripted([fauxAssistantMessage('', { stopReason: 'error', errorMessage: '额度用完' })]);
  const result = await replayCase(item, { prompt: '系统', tools: [] }, { role: 'user', content: '问', timestamp: 1 },
    model, AbortSignal.timeout(5_000));
  assert.equal(result.error, '额度用完');
});
