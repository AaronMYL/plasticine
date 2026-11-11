import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { RULES_DOC_ID } from '../../shared/state.ts';
import { ensureRulesDoc, addLine } from '../../src/brain/memory-doc-writes.ts';
import { rulesDocSection } from '../../src/brain/memory-docs-context.ts';
import { soulView, changeSoul } from '../../src/brain/soul.ts';
import { memoryState } from './helpers.ts';

const states: ReturnType<typeof memoryState>[] = [];
afterEach(() => { for (const state of states.splice(0)) state.close(); });
function setup() { const state = memoryState(); states.push(state); return state; }
const writer = { actor: 'user' as const, ref: 'device-fixture' };

test('新安装的 Soul 默认按三节展示，来源为系统且只创建一次', () => {
  const state = setup();
  ensureRulesDoc(state);
  ensureRulesDoc(state);
  const view = soulView(state);
  assert.equal(view.title, '规则');
  assert.equal(view.lines.length, 6);
  assert.deepEqual([...new Set(view.lines.map((line) => line.section))], ['speaking', 'doing', 'outbound']);
  assert.ok(view.lines.every((line) => line.source === 'system'));
  assert.ok(state.memoryDocs.lines.live(RULES_DOC_ID).every((line) => line.anchors[0]?.kind === 'system'));
  const prompt = rulesDocSection(state);
  assert.match(prompt, /系统默认/);
  assert.doesNotMatch(prompt, /每一行都来自用户原话/);
});

test('旧规矩改名但不冒加默认确认，分类后仍保留原话来源，后一次请求读新内容', () => {
  const state = setup();
  state.memoryDocs.docs.create({ kind: 'rules', title: '怎么替你做事', summary: '旧规矩', createdBy: 'system' },
    { id: RULES_DOC_ID });
  const original = addLine(state, { docId: RULES_DOC_ID, text: '回答先说结论', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'message-fixture' }] }, { actor: 'brain', ref: 'run-fixture' });
  ensureRulesDoc(state);
  assert.equal(soulView(state).lines.length, 1);
  assert.equal(soulView(state).lines[0]?.source, 'conversation');
  const edited = changeSoul(state, { requestId: 'edit-rule', action: 'edit', id: original.id,
    version: original.version, text: '先说一句结论，再给细节', section: 'speaking' }, writer);
  const line = edited.lines[0]!;
  assert.match(rulesDocSection(state), /先说一句结论，再给细节/);
  assert.equal(state.memoryDocs.lines.require(line.id).section, 'note');
  assert.deepEqual(state.memoryDocs.lines.require(line.id).anchors[0], original.anchors[0]);
  assert.equal(line.source, 'user');
  assert.equal(line.section, 'speaking');
  const restored = changeSoul(state, { requestId: 'undo-rule', action: 'undo', id: line.id,
    version: line.version }, writer);
  assert.equal(restored.lines[0]?.text, original.text);
  assert.equal(restored.lines[0]?.source, 'conversation');
  assert.ok(restored.history.some((change) => change.action === 'undo'));
});

test('撤销新增规则会退役并保留记录；再次初始化不复活默认规则；旧版本不可覆盖', () => {
  const state = setup();
  ensureRulesDoc(state);
  const first = soulView(state).lines[0]!;
  changeSoul(state, { requestId: 'undo-default', action: 'undo', id: first.id, version: first.version }, writer);
  ensureRulesDoc(state);
  assert.equal(soulView(state).lines.length, 5);
  assert.throws(() => changeSoul(state, { requestId: 'stale-edit', action: 'edit', id: first.id,
    version: first.version, text: '迟到的改动', section: 'doing' }, writer), /改过|撤销/);
  const added = changeSoul(state, { requestId: 'add-rule', action: 'add', text: '对外发出前核对收件人',
    section: 'outbound' }, writer);
  const row = added.lines.find((line) => line.text === '对外发出前核对收件人')!;
  assert.equal(row.source, 'user');
  assert.equal(row.section, 'outbound');
});

test('系统默认进读文档与整理材料都保留 system；用户改写才成为 stated', async () => {
  const { memoryDocView } = await import('../../src/brain/memory-docs-context.ts');
  const { relatedLines } = await import('../../src/brain/memory-curation-work.ts');
  const state = setup();
  const doc = ensureRulesDoc(state);
  const original = state.memoryDocs.lines.live(RULES_DOC_ID)[0]!;
  assert.equal(original.basis, 'system');
  assert.ok(memoryDocView(state, doc).lines.every((line) => line.basis === 'system'));
  const material = relatedLines(state, [doc], '规则');
  assert.ok(material[RULES_DOC_ID]?.every((line) => line.basis === 'system'));
  assert.ok(material[RULES_DOC_ID]?.every((line) => line.anchors[0]?.kind === 'system'));
  changeSoul(state, { requestId: 'source-write', action: 'edit', id: original.id, version: original.version,
    text: '先给一句结论。', section: 'speaking' }, writer);
  const changed = state.memoryDocs.lines.live(RULES_DOC_ID).find((line) => line.text === '先给一句结论。')!;
  assert.equal(changed.basis, 'stated');
  assert.deepEqual(changed.anchors.map((anchor) => anchor.kind), ['system', 'user_edit']);
});

test('只移动分类不会把系统默认改成用户确认，撤销恢复原分类', () => {
  const state = setup();
  ensureRulesDoc(state);
  const first = soulView(state).lines[0]!;
  const moved = changeSoul(state, { requestId: 'move-source', action: 'move', id: first.id,
    version: first.version, section: 'doing' }, writer).lines.find((line) => line.text === first.text)!;
  assert.equal(moved.source, 'system');
  assert.equal(moved.section, 'doing');
  const original = changeSoul(state, { requestId: 'undo-move', action: 'undo', id: moved.id,
    version: moved.version }, writer).lines.find((line) => line.text === first.text)!;
  assert.equal(original.section, 'speaking');
  assert.equal(original.source, 'system');
});
