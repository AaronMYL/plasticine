import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestState } from '../state/helpers.ts';
import { noteSupplementReferences } from '../../src/brain/note-supplement-context.ts';
import { parseNoteSupplements } from '../../src/brain/note-supplements.ts';

test('补充建议只返回四种类型的至多四条建议，正文和草稿分开', () => {
  const input = [{ kind: 'structure', text: '分成经过和想法两节', draft: '## 经过\n\n原来发生的事。' },
    { kind: 'supplement', text: '补上待确认的时间', draft: '具体时间：[待确认]。' },
    { kind: 'example', text: '把已有例子写具体', draft: '比如，原文中已经提到的那次尝试。' },
    { kind: 'contact', text: '关联同事林舟', draft: '可以和林舟核对细节。',
      reference: { kind: 'contact', id: 'contact_demo', label: '林舟' } }];
  const refs = [{ kind: 'contact' as const, id: 'contact_demo', label: '林舟' }];
  assert.deepEqual(parseNoteSupplements(JSON.stringify(input), refs), input);
  assert.deepEqual(parseNoteSupplements('[]', refs), []);
  assert.throws(() => parseNoteSupplements(JSON.stringify([...input, input[0]]), refs), /格式/);
  assert.throws(() => parseNoteSupplements('随意的一句话', refs), /格式/);
});

test('不把模型捏造的联系人或笔记变成有效关联', () => {
  const input = [{ kind: 'contact', text: '关联一个人', draft: '要向他核实。',
    reference: { kind: 'contact', id: 'made_up', label: '并不存在的人' } }];
  assert.throws(() => parseNoteSupplements(JSON.stringify(input), []), /关联/);
});

test('关联上下文只带正文提到的已有非私密笔记', async () => {
  const t = await openTestState();
  const state = t.state;
  try {
    const publicNote = state.notes.create({ markdown: '# 路线记录\n周末去过的小路。', author: 'user', folder: '笔记' });
    state.notes.create({ markdown: '# 私人记录\n不应传给模型。', author: 'user', folder: '笔记', private: true });
    const refs = noteSupplementReferences(state, { action: 'interject',
      markdown: '这里提到路线记录，也提到了私人记录。' });
    assert.deepEqual(refs, [{ kind: 'note', id: publicNote.id, label: '路线记录' }]);
  } finally { await t.cleanup(); }
});
