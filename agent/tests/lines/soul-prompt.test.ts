import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mates } from '../../src/mates/service.ts';
import { linePrompt } from '../../src/lines/prompt.ts';
import { changeSoul, soulView } from '../../src/brain/soul.ts';
import { ensureRulesDoc } from '../../src/brain/memory-doc-writes.ts';
import { adoptMateSouls } from '../../src/brain/mate-rules.ts';
import { startKernel } from './helpers.ts';

test('每位读自己的 Soul（第13批）：建队友时写的那段就是它的 Soul，别的队友看不到；主线读主线那份；改了下一次就生效', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    ensureRulesDoc(state);
    const mates = new Mates(state, () => h.kernel);
    const mate = mates.create({ name: '资料编辑', avatar: 'bunny' as const, hue: 'sky', role: '核对资料',
      soul: '你是我的资料编辑。\n\n## 说话\n- 这类报告使用简短列表。', purpose: null });
    const line = state.lines.require(mate.lineId);
    const other = mates.create({ name: '旅行顾问', avatar: 'penguin' as const, hue: 'teal', role: '订行程',
      soul: '', purpose: null });
    const before = linePrompt(state, line);
    assert.ok(before.indexOf('## 你的 Soul') < before.indexOf('## 规则'));
    assert.match(before, /这类报告使用简短列表/);
    assert.equal(soulView(state).lines.some((item) => item.text.includes('简短列表')), false, '不再拆成规则');
    const otherPrompt = linePrompt(state, state.lines.require(other.lineId));
    assert.doesNotMatch(otherPrompt, /简短列表/);
    assert.match(otherPrompt, /你是我的旅行顾问：订行程。/, '没写就照职责起个开头');
    // 主线派活看每位 Soul 的第一段。
    assert.match(linePrompt(state, state.lines.main()), /- 资料编辑（[^）]+）：你是我的资料编辑。/);
    assert.match(linePrompt(state, state.lines.main()), /你不是聊天机器人/);
    const soul = state.souls.get(mate.id)!;
    state.souls.write(mate.id, soul.version, '你是我的资料编辑。\n\n## 说话\n- 先说结论，再给原始资料。', 'user', '你改的');
    const after = linePrompt(state, line);
    assert.match(after, /先说结论，再给原始资料/);
    assert.doesNotMatch(after, /简短列表/);
    const first = soulView(state).lines[0]!;
    changeSoul(state, { requestId: 'line-soul-edit', action: 'edit', id: first.id, version: first.version,
      text: '先说结论，再给原始资料。', section: 'speaking' }, { actor: 'user', ref: 'device-fixture' });
    assert.match(linePrompt(state, state.lines.require(other.lineId)), /## 规则[\s\S]*先说结论，再给原始资料/);
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
