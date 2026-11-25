import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestState } from '../state/helpers.ts';
import { noteSupplementReferences } from '../../src/notes/note-supplement-context.ts';
import { parseNoteSupplements } from '../../src/notes/note-supplements.ts';

test('Supplement returns up to 4 suggestions of 4 types, separating body and draft', () => {
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

test('Does not turn model-hallucinated contacts or notes into valid links', () => {
  const input = [{ kind: 'contact', text: '关联一个人', draft: '要向他核实。',
    reference: { kind: 'contact', id: 'made_up', label: '并不存在的人' } }];
  assert.throws(() => parseNoteSupplements(JSON.stringify(input), []), /关联/);
});

test('Linked context includes only existing notes referenced in note body', async () => {
  const t = await openTestState();
  const state = t.state;
  try {
    const publicNote = state.notes.create({ markdown: '# 路线记录\n周末去过的小路。', author: 'user', folder: '笔记' });
    state.notes.create({ markdown: '# 采购清单\n正文没有提到的另一篇。', author: 'user', folder: '笔记' });
    const refs = noteSupplementReferences(state, { action: 'interject',
      markdown: '这里提到路线记录，别的没提。' });
    assert.deepEqual(refs, [{ kind: 'note', id: publicNote.id, label: '路线记录' }]);
  } finally { await t.cleanup(); }
});
