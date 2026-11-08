import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNoteTools, type Tool } from '../../../src/brain/index.ts';
import { openTestState } from '../../state/helpers.ts';
import { toolContext } from '../helpers.ts';

test('对话找到原笔记、读全文并追加；版本过期不覆盖；同名笔记不重复新建', async () => {
  const t = await openTestState();
  try {
    const note = t.state.notes.create({ markdown: '# X\n\n已有内容', folder: '笔记', author: 'user' });
    const changed: string[] = [];
    const tools = new Map<string, Tool>(createNoteTools(t.state, (id) => changed.push(id))
      .map((tool) => [tool.name, tool]));
    const run = (name: string, args: Record<string, unknown>, call: string) =>
      tools.get(name)!.execute(args, toolContext(call));
    assert.ok((await run('note_search', { q: '已有内容' }, 'c0')).includes(note.id));
    assert.ok((await run('note_read', { id: note.id }, 'c1')).includes('已有内容'));
    await run('note_append', { id: note.id, version: 1, markdown: '新增的一句' }, 'c2');
    assert.equal(t.state.notes.readBody(t.state.notes.require(note.id)), '# X\n\n已有内容\n\n新增的一句');
    assert.deepEqual(changed, [note.id]);
    await assert.rejects(run('note_append', { id: note.id, version: 1, markdown: '新增的一句' }, 'c3'));
    assert.equal(t.state.notes.versions(note.id).length, 2);
    const duplicate = await run('note_append', { title: 'X', markdown: '另一句' }, 'c4').catch((error: Error) =>
      error.message);
    assert.match(duplicate, /已有/);
    assert.equal(t.state.notes.list().length, 1);
  } finally { await t.cleanup(); }
});
