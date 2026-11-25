import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, json, pair, startTestApp } from './helpers.ts';

const change = { actor: 'user' as const, reason: '隔离来源测试' };

test('same quote on two lines: legacy memory reads source via own anchor without borrowing other line', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const quote = '以后先给结论，再保留完整依据。';
    const main = app.state.lines.main();
    const other = app.state.lines.create({ kind: 'background', parentLineId: null, projectId: null, title: '另一条' });
    const entries = [main, other].map((line) => {
      const row = app.state.lineMessages.append(line.id, 'user', { role: 'user', content: quote, timestamp: 0 });
      return app.state.memory.create({ kind: 'quote', basis: 'self_reported', text: quote,
        sourceId: 'source-user-said', provenance: '实际对话原文',
        anchor: { kind: 'message', ref: `line:${line.id}:${row.seq}` } }, change);
    });
    const original = entries[0]!;
    const detail = json(await call(app, 'GET', `/v2/memory/entries/${original.id}`, { cookie }));
    const context = detail['sourceContext'] as { ref: string; text: string; chatId: string };
    assert.equal(context.ref, original.anchor?.ref);
    assert.equal(context.chatId, main.id);
    assert.equal(context.text, quote);
  } finally { await app.close(); }
});
