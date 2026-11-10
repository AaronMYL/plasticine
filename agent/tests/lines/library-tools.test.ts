import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { Workspace } from '../../src/artifacts/index.ts';
import { libraryTools } from '../../src/library/tools.ts';
import { openTestState } from '../state/helpers.ts';

test('模型操作复用资料库回收，只有永久删除要确认；新笔记重放不会再建一份', async () => {
  const fixture = await openTestState();
  try {
    const { state } = fixture;
    const tools = libraryTools({ state, workspace: new Workspace(dirname(fixture.path), () => new Date()) });
    const tool = (name: string) => {
      const value = tools.find((entry) => entry.name === name);
      assert.ok(value, name);
      return value;
    };
    const run = async (name: string, args: unknown, call = 'test-call') => {
      const result = await tool(name).create({ lineId: 'line-main', kind: 'main', projectId: null })
        .execute(call, args as never);
      const first = result.content[0];
      assert.equal(first?.type, 'text');
      return JSON.parse(first.text) as Record<string, unknown>;
    };
    const input = { markdown: '# 一篇笔记\n\n原来的正文' };
    const first = await run('note_create', input);
    assert.equal((await run('note_create', input))['id'], first['id']);
    const id = String(first['id']);
    assert.equal((await run('library_list', {}))['notes'] instanceof Array, true);
    await run('note_update', { id, version: 1, markdown: '# 一篇笔记\n\n已经改在原处' });
    assert.match(state.notes.readBody(state.notes.require(id)), /已经改在原处/);
    await run('note_move', { id, folder: '归档' });
    assert.equal(state.notes.require(id).folder, '归档');
    assert.equal(tool('note_delete').hardLine({ id }), null);
    await run('note_delete', { id });
    assert.notEqual(state.notes.require(id).deletedAt, null);
    await run('note_restore', { id });
    assert.equal(state.notes.require(id).deletedAt, null);
    await run('note_delete', { id });
    const args = { action: 'purge', items: [{ kind: 'note', id }] };
    assert.equal(tool('library_batch').hardLine(args), 'irreversible');
    assert.match(tool('library_batch').consequence!(args), /永久删除 1 项/);
    await run('library_batch', args);
    assert.equal(state.notes.get(id), undefined);
    assert.equal((await run('library_batch', args, 'retry-purge'))['succeeded'], 1);
    await assert.rejects(run('note_create', input), /已经有/);
  } finally { await fixture.cleanup(); }
});
