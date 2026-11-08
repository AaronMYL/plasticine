// 空间与订阅（《优化清单》第 6、7 条）：存取、版本和撤销、订阅的各期、全文索引和档位、「Plasticine 写的」迁成空间。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { SpaceDoc, SubscriptionInput } from '../../shared/state.ts';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { NoteBodies } from '../../src/state/note-bodies.ts';
import { NOTES_DIRECTORY, openState } from '../../src/state/index.ts';
import { join } from 'node:path';
import { openTestState, steppingClock, tempDirectory, throwsState, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function doc(text: string, extra: Partial<SpaceDoc> = {}): SpaceDoc {
  return { headline: text, stats: [], blocks: [{ type: 'text', markdown: text }], sources: [], ...extra };
}

function research(): SubscriptionInput {
  return { title: '认知与神经科学研究周报', kind: 'research', status: 'draft', timeZone: 'Asia/Shanghai',
    settings: { kind: 'research', topics: ['睡眠'], focus: null, depth: null, sources: [], preprints: 'mark',
      filter: '', schedule: { every: 'week', weekday: 1, time: '09:00' }, sections: ['本周概览'], output: '',
      rules: [] } };
}

test('新建空间记第 1 版；保存记新的一版、带「改了什么」和「以后都这样」；撤销恢复上一版的正文', () => {
  const space = t.state.spaces.create({ title: '马来西亚签证核查', doc: doc('第一稿'), author: 'ai' });
  assert.equal(space.version, 1);
  const saved = t.state.spaces.save(space.id, 1, { doc: doc('第二稿') }, 'ai',
    { change: '图从 4 张减到 1 张', rule: '每期最多 1 张图' });
  assert.equal(saved.version, 2);
  assert.deepEqual(t.state.spaces.revisions(space.id).map((row) => [row.version, row.change, row.rule]),
    [[2, '图从 4 张减到 1 张', '每期最多 1 张图'], [1, null, null]]);
  const undone = t.state.spaces.undo(space.id, 2, 'user');
  assert.equal(undone.version, 3);
  assert.deepEqual(undone.doc, doc('第一稿'));
  assert.equal(t.state.spaces.revision(space.id, 3)?.restoredFrom, 1);
  throwsState(() => t.state.spaces.save(space.id, 2, { doc: doc('过时') }, 'user'), 'version_conflict');
});

test('没改动的保存不记新版本；最早一版不能撤销', () => {
  const space = t.state.spaces.create({ title: '草稿', doc: doc('一样'), author: 'user' });
  assert.equal(t.state.spaces.save(space.id, 1, { doc: doc('一样') }, 'user').version, 1);
  throwsState(() => t.state.spaces.undo(space.id, 1, 'user'), 'invalid_input');
});

test('订阅的各期按期号排，期号不重用；删掉的空间不在列表里', () => {
  const sub = t.state.subscriptions.create(research());
  assert.equal(t.state.spaces.nextIssueNumber(sub.id), 1);
  const first = t.state.spaces.create({ title: '第 1 期', doc: doc('一'), author: 'ai', subscriptionId: sub.id,
    issueNumber: 1 });
  t.state.spaces.create({ title: '第 2 期', doc: doc('二'), author: 'ai', subscriptionId: sub.id, issueNumber: 2 });
  assert.deepEqual(t.state.spaces.issues(sub.id).map((row) => row.issueNumber), [2, 1]);
  t.state.spaces.markDeleted(first.id, 1);
  assert.deepEqual(t.state.spaces.issues(sub.id).map((row) => row.issueNumber), [2]);
  assert.equal(t.state.spaces.nextIssueNumber(sub.id), 3);
  assert.deepEqual(t.state.spaces.list().map((row) => row.title), ['第 2 期']);
});

test('空间进统一全文索引：正文、图表说明都查得到；档位照 visibility_marks，没标的私密；删了查不到', () => {
  const space = t.state.spaces.create({ title: '睡眠周报', author: 'ai', doc: doc('海马体重放', {
    blocks: [{ type: 'chart', kind: 'line', title: '重放与回忆', x: [0, 1], series: [{ name: '正确率', values: [1, 2] }],
      caption: '颅内记录的重放次数', source: { label: '论文表 2' } }] }) });
  const ids = (q: string, extra: Record<string, unknown> = {}) =>
    t.state.search.query({ q, ...extra }).results.map((row) => [row.kind, row.id]);
  assert.deepEqual(ids('颅内记录'), [['space', space.id]]);
  assert.deepEqual(ids('颅内记录', { type: 'spaces' }), [['space', space.id]]);
  assert.deepEqual(ids('颅内记录', { maxTier: 'friend' }), []);
  t.state.visibilityMarks.put('space', space.id, 0, { tier: 'friend', proposed: null, confirmed: true });
  assert.deepEqual(ids('颅内记录', { maxTier: 'friend' }), [['space', space.id]]);
  t.state.spaces.markDeleted(space.id, space.version);
  assert.deepEqual(ids('颅内记录'), []);
});

test('迁移 0084：「Plasticine 写的」整体迁成空间，原笔记标上去向、不再出现；文件夹不再列出；档位跟着走', async () => {
  const dir = await tempDirectory();
  const path = join(dir.directory, 'plasticine.sqlite');
  const bodies = new NoteBodies(join(dir.directory, NOTES_DIRECTORY));
  // 早于测试时钟（steppingClock 从 10-27 起）：查找只看「现在」以前改过的。
  const T = '2026-10-20T02:00:00.000Z';
  try {
    const old = openDatabase(path);
    migrate(old, MIGRATIONS.filter((entry) => entry.id < '0084'), () => T, {
      writeNoteBody(noteId, markdown) {
        const file = bodies.fileFor(noteId);
        const digest = bodies.write(file, markdown);
        return { file, bytes: digest.bytes, sha256: digest.sha256 };
      },
    });
    const note = (id: string, folder: string, markdown: string, deleted: string | null = null): void => {
      const file = bodies.fileFor(id);
      const digest = bodies.write(file, markdown);
      old.run(`INSERT INTO notes (id, created_at, updated_at, version, title, folder, author, preview, body_file,
        body_bytes, body_sha256, deleted_at) VALUES ($id, $t, $t, 1, $title, $folder, 'ai', '', $file, $bytes, $sha,
        $deleted)`, { id, t: T, title: markdown.split('\n')[0]!.replace(/^#\s*/, ''), folder, file,
        bytes: digest.bytes, sha: digest.sha256, deleted });
    };
    note('n-rules', 'Plasticine 写的', '# 悬赏规则草稿\n\n开头。\n\n## 验收\n\n怎么验收。');
    note('n-trash', 'Plasticine 写的', '# 删掉的草稿', T);
    note('n-mine', '笔记', '# 我自己写的');
    old.run(`INSERT INTO note_folders (name, position) VALUES ('Plasticine 写的', 1)`);
    old.run(`INSERT INTO visibility_marks (id, created_at, updated_at, version, object_kind, object_id, tier, proposed,
      confirmed_at) VALUES ('note:n-rules', $t, $t, 1, 'note', 'n-rules', 'partner', NULL, $t)`, { t: T });
    old.close();

    const state = openState({ path, now: steppingClock() });
    try {
      assert.equal(state.newlyApplied[0], '0084-ai-notes-to-spaces');
      const space = state.spaces.get('sp-n-rules');
      assert.equal(space?.title, '悬赏规则草稿');
      assert.equal(space?.author, 'ai');
      assert.equal(space?.sourceNoteId, 'n-rules');
      assert.deepEqual(space?.doc.blocks.map((block) => block.type), ['text', 'heading', 'text']);
      assert.equal(state.spaces.get('sp-n-trash'), undefined);
      assert.deepEqual(state.notes.list().map((row) => row.id), ['n-mine']);
      assert.deepEqual(state.notes.list({ deletedOnly: true }).map((row) => row.id), ['n-trash']);
      assert.ok(state.notes.get('n-rules') !== undefined, '原笔记的行留着');
      assert.equal(bodies.read('n-rules.md').startsWith('# 悬赏规则草稿'), true, '正文文件留着');
      assert.deepEqual(state.notes.folders.list().folders.map((folder) => folder.name), ['笔记']);
      assert.equal(state.visibilityMarks.get('space', 'sp-n-rules')?.tier, 'partner');
      assert.deepEqual(state.search.query({ q: '怎么验收' }).results.map((row) => [row.kind, row.id]),
        [['space', 'sp-n-rules']]);
    } finally {
      state.close();
    }
  } finally {
    await dir.cleanup();
  }
});
