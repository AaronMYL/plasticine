// 记忆库重构（《优化清单》第 16、10 条，11-06 定）的存储：三层（现行 → 归档 → 删除）、「今天的记录」、
// 「昨晚整理了什么」的表和读取。归档是明确的字段（archived_at）；11-07 他定「删除」真的从库里抹掉：他说「忘掉」的行、
// 满 30 天的记录行删除，统一全文索引里的条目同一事务删掉。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { YOU_DOC_ID } from '../../shared/state.ts';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { openTestState, steppingClock, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const anchor = { kind: 'message' as const, ref: 'line:main:3' };

function youDoc() {
  return t.state.memoryDocs.docs.create({ kind: 'you', title: '关于你', summary: '身份、住处。', createdBy: 'system' },
    { id: YOU_DOC_ID });
}

function line(docId: string, text: string) {
  return t.state.memoryDocs.lines.add({ docId, text, basis: 'stated', anchors: [anchor], writtenBy: 'brain' });
}

test('三层：被改掉的旧行进归档，他要忘掉的记删除；归档能列能搜，删除的哪里都不出现', () => {
  const doc = youDoc();
  const old = line(doc.id, '住在杭州');
  const forgotten = line(doc.id, '喜欢喝冰美式');
  const archived = t.state.memoryDocs.lines.retire(old.id, old.version, 'revised');
  assert.equal(archived.archivedAt, archived.retiredAt);
  assert.equal(archived.deletedAt, null);
  const deleted = t.state.memoryDocs.lines.retire(forgotten.id, forgotten.version, 'forgotten');
  assert.equal(deleted.deletedAt, deleted.retiredAt);
  assert.equal(deleted.archivedAt, null);
  assert.deepEqual(t.state.memoryDocs.lines.archived(doc.id).map((row) => row.text), ['住在杭州']);
  assert.deepEqual(t.state.memoryDocs.lines.retired(doc.id).map((row) => row.text), ['住在杭州']);
  assert.deepEqual(t.state.memoryDocs.lines.allArchived().map((row) => row.text), ['住在杭州']);
  assert.deepEqual(t.state.memoryDocs.lines.live(doc.id), []);
});

test('忘掉：现行和归档里的行真的从库里删掉，索引里的条目一起删；接替它的行上「之前：…」也抹掉；没有的行报找不到', () => {
  const doc = youDoc();
  const current = line(doc.id, '在做 Cyber Hunter');
  const old = line(doc.id, '住在杭州西湖区');
  t.state.memoryDocs.lines.retire(old.id, old.version, 'revised');
  const successor = t.state.memoryDocs.lines.add({ docId: doc.id, text: '住在杭州', basis: 'stated',
    anchors: [anchor], previous: '住在杭州西湖区', supersedes: [old.id], writtenBy: 'brain' });
  assert.equal(t.state.search.find({ q: 'Cyber Hunter' }).length, 1);
  const gone = t.state.memoryDocs.lines.forget([current.id, old.id]);
  assert.deepEqual(gone.map((row) => row.id).sort(), [current.id, old.id].sort());
  assert.equal(t.state.memoryDocs.lines.get(current.id), undefined);
  assert.equal(t.state.memoryDocs.lines.get(old.id), undefined);
  assert.deepEqual(t.state.memoryDocs.lines.live(doc.id).map((row) => row.id), [successor.id]);
  assert.deepEqual(t.state.memoryDocs.lines.archived(doc.id), []);
  const kept = t.state.memoryDocs.lines.get(successor.id);
  assert.equal(kept?.previous, null);
  assert.equal(kept?.text, '住在杭州');
  assert.equal(kept?.version, successor.version + 1);
  assert.deepEqual(t.state.search.find({ q: 'Cyber Hunter', includeArchived: true }), []);
  assert.deepEqual(t.state.search.find({ q: '高新区', includeArchived: true }), []);
  throwsState(() => t.state.memoryDocs.lines.forget([old.id]), 'not_found');
});

test('今天的记录只追加：按写的先后列还没整理的；整理完进归档，30 天后记删除', () => {
  const journal = t.state.memoryJournal;
  const first = journal.add({ day: '2026-11-07', kind: 'decision', text: '侧栏改成图标栏 + 第二栏',
    anchors: [anchor], writtenBy: 'brain', writtenRef: 'job-1' });
  const second = journal.add({ day: '2026-11-07', kind: 'remembered', text: '通知只发消息', anchors: [anchor],
    docId: YOU_DOC_ID, lineId: 'line-1', writtenBy: 'brain' });
  assert.equal(first.archivedAt, null);
  assert.deepEqual(journal.open().map((entry) => entry.id), [first.id, second.id]);
  throwsState(() => journal.add({ day: '11-07', kind: 'fact', text: '没有出处', anchors: [], writtenBy: 'brain' }),
    'invalid_input');

  const archived = journal.archive([first.id], 'dream-1');
  assert.equal(archived.length, 1);
  assert.equal(archived[0]?.dreamId, 'dream-1');
  assert.deepEqual(journal.open().map((entry) => entry.id), [second.id]);
  assert.deepEqual(journal.archived().map((entry) => entry.id), [first.id]);

  const at = Date.parse(archived[0]?.archivedAt ?? '');
  assert.equal(journal.expire(new Date(at + 29 * 86_400_000)), 0);
  assert.equal(journal.expire(new Date(at + 31 * 86_400_000)), 1);
  assert.deepEqual(journal.archived(), []);
  assert.equal(journal.get(first.id), undefined, '满 30 天的那条真的删了');
  assert.equal(journal.get(second.id)?.text, '通知只发消息', '还没整理的不动');
});

test('今天的记录里「忘掉」的条目真的删掉；已经删过的不再算', () => {
  const journal = t.state.memoryJournal;
  const entry = journal.add({ day: '2026-11-07', kind: 'fact', text: '以前的猫叫小周', anchors: [anchor],
    writtenBy: 'brain' });
  const other = journal.add({ day: '2026-11-07', kind: 'fact', text: '住在杭州', anchors: [anchor],
    writtenBy: 'brain' });
  assert.equal(journal.forget([entry.id]), 1);
  assert.equal(journal.forget([entry.id]), 0);
  assert.equal(journal.get(entry.id), undefined);
  assert.deepEqual(journal.open().map((row) => row.id), [other.id]);
});

test('昨晚整理了什么：一次整理一组变更，按次序读；没做完的不算最近一次；每条可撤销、拿不准的可挑一个', () => {
  const dreams = t.state.memoryDreams;
  assert.equal(dreams.latest(), undefined);
  const dream = dreams.create({ startedAt: '2026-11-06T17:00:00.000Z', linesRead: 6, conversationsRead: 43 });
  const add = dreams.addChange({ dreamId: dream.id, kind: 'add', docId: YOU_DOC_ID, lineId: 'line-9',
    text: '研究周报偏基础研究', anchors: [anchor] });
  const unsure = dreams.addChange({ dreamId: dream.id, kind: 'unsure', text: '悬赏先挂哪里', anchors: [],
    candidates: [{ text: 'GitHub Issues', anchors: [anchor] }, { text: 'Cyber Hunter 网站', anchors: [anchor] }] });
  assert.deepEqual([add.position, unsure.position], [0, 1]);
  assert.equal(dreams.latest(), undefined);
  const finished = dreams.finish(dream.id, dream.version);
  assert.equal(dreams.latest()?.id, finished.id);
  assert.deepEqual(dreams.changes(dream.id).map((change) => change.kind), ['add', 'unsure']);

  const undone = dreams.updateChange(add.id, add.version, { undoneAt: '2026-11-07T02:00:00.000Z' });
  assert.equal(undone.undoneAt, '2026-11-07T02:00:00.000Z');
  throwsState(() => dreams.updateChange(add.id, add.version, { undoneAt: '2026-11-07T02:00:00.000Z' }),
    'version_conflict');
  const chosen = dreams.updateChange(unsure.id, unsure.version, { chosen: 1, resolvedAt: '2026-11-07T02:01:00.000Z' });
  assert.equal(chosen.chosen, 1);
});

test('迁移 0070：已经退休的行按原因归位（忘掉的记删除，其余进归档），在用的不动；重跑不再改', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0070'), now);
    db.run(`INSERT INTO memory_docs (id, created_at, updated_at, version, kind, title, summary, char_limit,
      created_by) VALUES ('memdoc-you', $at, $at, 1, 'you', '关于你', '', 4000, 'system')`, { at: now() });
    const insert = (id: string, retiredAt: string | null, reason: string | null) => db.run(`INSERT INTO
      memory_doc_lines (id, created_at, updated_at, version, doc_id, section, text, basis, anchors, supersedes,
      position, written_by, retired_at, retired_reason) VALUES ($id, $at, $at, 1, 'memdoc-you', 'note', $id,
      'stated', '[{"kind":"message","ref":"m"}]', '[]', 0, 'brain', $retired, $reason)`,
    { id, at: now(), retired: retiredAt, reason });
    insert('live', null, null);
    insert('revised', '2026-11-01T00:00:00.000Z', 'revised');
    insert('forgotten', '2026-11-02T00:00:00.000Z', 'forgotten');
    assert.deepEqual(migrate(db, MIGRATIONS.filter((entry) => entry.id <= '0070-memory-layers'), now),
      ['0070-memory-layers']);
    const rows = db.all('SELECT id, archived_at, deleted_at FROM memory_doc_lines ORDER BY id');
    assert.deepEqual(rows.map((row) => [row['id'], row['archived_at'], row['deleted_at']]), [
      ['forgotten', null, '2026-11-02T00:00:00.000Z'],
      ['live', null, null],
      ['revised', '2026-11-01T00:00:00.000Z', null],
    ]);
  } finally {
    db.close();
  }
});
