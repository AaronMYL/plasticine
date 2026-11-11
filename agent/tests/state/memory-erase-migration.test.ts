// 迁移 0098（11-07 他定「删除」真的从库里抹掉）：以前只打了 deleted_at 的记忆行、今天的记录一次性真删（撤不回），
// 只删 deleted_at 非空的行；接替它们的行上「之前：…」、昨晚整理的变更、确认过的推断里存的原文抹掉；「忘掉」事件里他的原话
// 去掉，只留删了几行；索引里残留的条目一起删。别的行一概不动。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FORGOTTEN_TEXT, YOU_DOC_ID } from '../../shared/state.ts';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { createMemoryCurationStores } from '../../src/state/memory-curation.ts';
import { createMemoryDocStores } from '../../src/state/memory-docs.ts';
import { createMemoryDreamStore } from '../../src/state/memory-dreams.ts';
import { createMemoryJournalStore } from '../../src/state/memory-journal.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { ftsHits, tablesHolding } from './residue.ts';
import { steppingClock } from './helpers.ts';

const ERASE_ID = '0098-erase-deleted-memory';
const anchors = [{ kind: 'message' as const, ref: 'line:main:1' }];

function stores(db: Database) {
  let next = 0;
  const context: StoreContext = { db, now: steppingClock(), newId: () => `id-${(next += 1)}` };
  return { docs: createMemoryDocStores(context), journal: createMemoryJournalStore(context),
    dreams: createMemoryDreamStore(context), curation: createMemoryCurationStores(context) };
}

function staleIndexEntry(db: Database, ref: string, body: string): void {
  const id = Number(db.get(`INSERT INTO search_docs (source, ref, kind, object_kind, object_id, title, body, detail,
    updated_at) VALUES ('memory_line', $ref, 'memory', 'memory_doc', $doc, '关于你', $body, '记忆', $at)
    RETURNING id`, { ref, doc: YOU_DOC_ID, body, at: '2026-11-01T00:00:00.000Z' })?.['id']);
  db.run(`INSERT INTO search_fts (rowid, title, body, detail) VALUES ($id, '关于你', $body, '记忆')`, { id, body });
}

/** 今天的记忆行存取带适用范围（0130）；在 0130 之前的库上用它写行，先补上这两列（之后的迁移不碰它们）。 */
function withScopeColumns(db: { exec(sql: string): void }): void {
  db.exec("ALTER TABLE memory_doc_lines ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'all'");
  db.exec('ALTER TABLE memory_doc_lines ADD COLUMN scope_ref TEXT');
}

test('迁移 0098 可以删东西，登记在 0098–0099 号段', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ERASE_ID);
  assert.equal(entry?.destructive, true);
});

test('迁移 0098：只删 deleted_at 非空的记忆行和记录行，相关原文抹掉，其余一概不动；删后库里查不到原文', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    migrate(db, MIGRATIONS.filter((migration) => migration.id < ERASE_ID), now);
    withScopeColumns(db);
    const s = stores(db);
    s.docs.docs.create({ kind: 'you', title: '关于你', summary: '身份、住处。', createdBy: 'system' },
      { id: YOU_DOC_ID });
    const add = (text: string) => s.docs.lines.add({ docId: YOU_DOC_ID, text, basis: 'stated', anchors,
      writtenBy: 'brain' });
    const live = add('住在杭州');
    const archivedLine = add('住在杭州西湖区');
    s.docs.lines.retire(archivedLine.id, archivedLine.version, 'revised');
    const gone = add('以前的猫叫小周');
    s.docs.lines.retire(gone.id, gone.version, 'forgotten');
    const successor = s.docs.lines.add({ docId: YOU_DOC_ID, text: '养了一盆绿萝', basis: 'stated', anchors,
      previous: '以前的猫叫小周', supersedes: [gone.id], writtenBy: 'brain' });
    staleIndexEntry(db, gone.id, '以前的猫叫小周');
    staleIndexEntry(db, live.id, '住在杭州');

    const open = s.journal.add({ day: '2026-11-07', kind: 'fact', text: '住在杭州', anchors, writtenBy: 'brain' });
    const expired = s.journal.add({ day: '2026-10-01', kind: 'fact', text: '小周来过', anchors, writtenBy: 'brain' });
    db.run('UPDATE memory_journal SET deleted_at = $at WHERE id = $id', { at: '2026-11-01T00:00:00.000Z',
      id: expired.id });

    const dream = s.dreams.create({ startedAt: '2026-11-06T17:00:00.000Z', linesRead: 1, conversationsRead: 1 });
    const added = s.dreams.addChange({ dreamId: dream.id, kind: 'add', docId: YOU_DOC_ID, lineId: gone.id,
      text: '以前的猫叫小周', anchors });
    const replaced = s.dreams.addChange({ dreamId: dream.id, kind: 'replace', docId: YOU_DOC_ID,
      lineId: successor.id, oldLineId: gone.id, text: '养了一盆绿萝', previous: '以前的猫叫小周', anchors });
    const inference = s.curation.inferences.create({ docId: YOU_DOC_ID, text: '以前的猫叫小周', why: '提过小周',
      anchors, lineId: gone.id });
    s.docs.events.add({ docId: YOU_DOC_ID, lineId: null, kind: 'lines_forgotten', actor: 'brain', actorRef: null,
      detail: { lineIds: [gone.id], why: '小周的事' } });

    const upToErase = MIGRATIONS.filter((migration) => migration.id <= ERASE_ID);
    assert.deepEqual(migrate(db, upToErase, now), [ERASE_ID]);

    const lineIds = db.all('SELECT id FROM memory_doc_lines ORDER BY id').map((row) => row['id']);
    assert.deepEqual(lineIds, [live.id, archivedLine.id, successor.id].sort());
    assert.equal(s.docs.lines.get(successor.id)?.previous, null);
    assert.equal(s.docs.lines.get(archivedLine.id)?.archivedAt !== null, true, '归档的不动');
    assert.deepEqual(db.all('SELECT id FROM memory_journal').map((row) => row['id']), [open.id]);
    assert.equal(s.dreams.requireChange(added.id).text, FORGOTTEN_TEXT);
    assert.equal(s.dreams.requireChange(replaced.id).previous, null);
    assert.equal(s.dreams.requireChange(replaced.id).text, '养了一盆绿萝');
    assert.equal(s.curation.inferences.require(inference.id).text, FORGOTTEN_TEXT);
    const forgotten = s.docs.events.recent(YOU_DOC_ID, 10).filter((event) => event.kind === 'lines_forgotten');
    assert.deepEqual(forgotten.map((event) => event.detail), [{ lines: 1 }]);

    assert.deepEqual(tablesHolding(db, '小周'), []);
    assert.equal(ftsHits(db, '以前的猫叫小周'), 0);
    assert.equal(ftsHits(db, '住在杭州'), 1, '别的索引条目不动');
    assert.deepEqual(migrate(db, upToErase, now), [], '重跑不再改');
  } finally {
    db.close();
  }
});
