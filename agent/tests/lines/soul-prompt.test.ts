import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mates } from '../../src/mates/service.ts';
import { linePrompt } from '../../src/lines/prompt.ts';
import { changeSoul, soulView } from '../../src/brain/soul.ts';
import { ensureRulesDoc } from '../../src/brain/memory-doc-writes.ts';
import { adoptMateSouls } from '../../src/brain/mate-rules.ts';
import { startKernel } from './helpers.ts';

test('每次请求先共用规则后只对这位队友的规则，队友的规则明确优先，别的队友的不给；编辑下一次就生效', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    ensureRulesDoc(state);
    const mates = new Mates(state, () => h.kernel);
    const mate = mates.create({ name: '资料编辑', avatar: 'bunny' as const, hue: 'sky', role: '核对资料',
      soul: '这类报告使用简短列表。', purpose: null });
    const line = state.lines.require(mate.lineId);
    const other = mates.create({ name: '旅行顾问', avatar: 'penguin' as const, hue: 'teal', role: '订行程',
      soul: '- 只订直飞航班。', purpose: null });
    const before = linePrompt(state, line);
    assert.ok(before.indexOf('## 规则') < before.indexOf('## 只对你的规则'));
    assert.match(before, /冲突时，以这几条为准/);
    assert.doesNotMatch(before, /只订直飞航班/);
    assert.match(linePrompt(state, state.lines.require(other.lineId)), /只订直飞航班/);
    const view = soulView(state).lines.find((item) => item.text === '这类报告使用简短列表。')!;
    assert.equal(view.scopeKind, 'mate');
    assert.equal(view.scopeRef, mate.id);
    assert.equal(view.source, 'mate');
    const first = soulView(state).lines[0]!;
    changeSoul(state, { requestId: 'line-soul-edit', action: 'edit', id: first.id, version: first.version,
      text: '先说结论，再给原始资料。', section: 'speaking' }, { actor: 'user', ref: 'device-fixture' });
    const after = linePrompt(state, line);
    assert.match(after, /先说结论，再给原始资料/);
    assert.doesNotMatch(after, /直接讲内容，先说结论。/);
    assert.match(after, /这类报告使用简短列表/);
    changeSoul(state, { requestId: 'line-soul-scope', action: 'scope', id: view.id, version: view.version,
      scopeKind: 'all', scopeRef: null }, { actor: 'user', ref: 'device-fixture' });
    assert.match(linePrompt(state, state.lines.require(other.lineId)), /这类报告使用简短列表/);
  } finally { await h.close(); }
});

test('队友原来的 Soul 拆成只对它的规则：一行一条、去掉列表符号和标题，只拆一次', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    const mate = state.mates.create({ name: '研究员', avatar: 'cat' as const, hue: 'sky', role: '查资料',
      soul: '# 研究员\n- 报告里的数字带来源链接\n\n2. 先列结论', purpose: null, lineId: state.lines.main().id });
    adoptMateSouls(state);
    adoptMateSouls(state);
    const own = soulView(state).lines.filter((line) => line.scopeRef === mate.id).map((line) => line.text);
    assert.deepEqual(own, ['报告里的数字带来源链接', '先列结论']);
    assert.equal(state.mates.require(mate.id).soul.includes('报告里的数字'), true, '原字段保留');
  } finally { await h.close(); }
});
