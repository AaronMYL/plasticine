import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mates } from '../../src/mates/service.ts';
import { linePrompt } from '../../src/lines/prompt.ts';
import { changeSoul, soulView } from '../../src/brain/soul.ts';
import { ensureRulesDoc } from '../../src/brain/memory-doc-writes.ts';
import { startKernel } from './helpers.ts';

test('每次请求先主线 Soul 后队友 Soul，队友冲突规则明确优先，主线编辑下一次就生效', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    ensureRulesDoc(state);
    const mates = new Mates(state, () => h.kernel);
    const mate = mates.create({ name: '资料编辑', avatar: '编', hue: 'sky', role: '核对资料',
      soul: '这类报告使用简短列表。', purpose: null });
    const line = state.lines.require(mate.lineId);
    const before = linePrompt(state, line);
    assert.ok(before.indexOf('## 主线的 Soul') < before.indexOf('## 队友的 Soul'));
    assert.match(before, /有冲突时，以队友专属规则为准/);
    const first = soulView(state).lines[0]!;
    changeSoul(state, { requestId: 'line-soul-edit', action: 'edit', id: first.id, version: first.version,
      text: '先说结论，再给原始资料。', section: 'speaking' }, { actor: 'user', ref: 'device-fixture' });
    const after = linePrompt(state, line);
    assert.match(after, /先说结论，再给原始资料/);
    assert.doesNotMatch(after, /直接讲内容，先说结论。/);
    assert.match(after, /这类报告使用简短列表/);
  } finally { await h.close(); }
});
