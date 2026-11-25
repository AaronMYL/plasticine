import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { FORGOTTEN_TEXT, YOU_DOC_ID } from '../../shared/state.ts';
import { addLine, ensureMemoryDocs, forgetMemory, reviseLine } from '../../src/memory/index.ts';
import { openDatabase } from '../../src/state/db.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { ftsHits, tablesHolding } from '../state/residue.ts';

let t: TestState;
const writer = { actor: 'brain' as const, ref: 'line:main:forget-1' };
const anchors = [{ kind: 'message' as const, ref: 'line:main:1' }];

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function seed() {
  const { state } = t;
  ensureMemoryDocs(state);
  const current = addLine(state, { docId: YOU_DOC_ID, text: '以前的猫叫小周，是只橘猫', basis: 'stated', anchors }, writer);
  const old = addLine(state, { docId: YOU_DOC_ID, text: '和小周住在一起', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.retire(old.id, old.version, 'no_longer_true');
  const cafe = addLine(state, { docId: YOU_DOC_ID, text: '常去的咖啡店是 Seesaw', basis: 'stated', anchors }, writer);
  const newer = reviseLine(state, cafe, '常去的咖啡店是 Manner', anchors, writer);
  const kept = addLine(state, { docId: YOU_DOC_ID, text: '住在杭州', basis: 'stated', anchors }, writer);
  state.memoryJournal.add({ day: '2026-11-07', kind: 'remembered', text: current.text, anchors, docId: YOU_DOC_ID,
    lineId: current.id, writtenBy: 'brain' });
  state.memoryJournal.add({ day: '2026-11-07', kind: 'fact', text: '和小周住在一起', anchors, writtenBy: 'brain' });
  const other = state.memoryJournal.add({ day: '2026-11-07', kind: 'fact', text: '住在杭州', anchors,
    writtenBy: 'brain' });
  const dream = state.memoryDreams.create({ startedAt: '2026-11-06T17:00:00.000Z', linesRead: 2,
    conversationsRead: 3 });
  const added = state.memoryDreams.addChange({ dreamId: dream.id, kind: 'add', docId: YOU_DOC_ID,
    lineId: current.id, text: current.text, anchors });
  const replaced = state.memoryDreams.addChange({ dreamId: dream.id, kind: 'replace', docId: YOU_DOC_ID,
    lineId: newer.id, oldLineId: cafe.id, text: newer.text, previous: cafe.text, anchors });
  const inference = state.memoryCuration.inferences.create({ docId: YOU_DOC_ID, text: current.text,
    why: '他提到小周两次', anchors, lineId: current.id });
  return { current, old, cafe, newer, kept, other, added, replaced, inference };
}

test('Forget hard-deletes lines and logs, scrubs text from refs/diffs, logs count only', () => {
  const { state } = t;
  const seeded = seed();
  const result = forgetMemory(state, [seeded.current.id, seeded.old.id, seeded.cafe.id], writer);
  assert.equal(result.lines.length, 3);
  assert.equal(result.journal, 2);

  for (const line of [seeded.current, seeded.old, seeded.cafe]) {
    assert.equal(state.memoryDocs.lines.get(line.id), undefined);
  }
  assert.deepEqual(state.memoryDocs.lines.live(YOU_DOC_ID).map((line) => line.text).sort(),
    ['住在杭州', '常去的咖啡店是 Manner'].sort());
  assert.equal(state.memoryDocs.lines.get(seeded.newer.id)?.previous, null);
  assert.deepEqual(state.memoryJournal.open().map((entry) => entry.id), [seeded.other.id]);

  const added = state.memoryDreams.requireChange(seeded.added.id);
  assert.equal(added.text, FORGOTTEN_TEXT);
  const replaced = state.memoryDreams.requireChange(seeded.replaced.id);
  assert.equal(replaced.text, '常去的咖啡店是 Manner');
  assert.equal(replaced.previous, null);
  const inference = state.memoryCuration.inferences.require(seeded.inference.id);
  assert.equal(inference.text, FORGOTTEN_TEXT);
  assert.equal(inference.why, '');

  const events = state.memoryDocs.events.recent(YOU_DOC_ID, 50).filter((event) => event.kind === 'lines_forgotten');
  assert.deepEqual(events.map((event) => event.detail), [{ lines: 3 }]);
});

test('Forgotten text absent from all tables, FTS shadow/MATCH, and DB bytes; rest kept', () => {
  const seeded = seed();
  assert.equal(t.state.search.find({ q: '是只橘猫' }).length, 1, '删之前索引里查得到');
  forgetMemory(t.state, [seeded.current.id, seeded.old.id, seeded.cafe.id], writer);
  t.close();
  const db = openDatabase(t.path);
  try {
    for (const needle of ['小周', '是只橘猫', 'Seesaw']) {
      assert.deepEqual(tablesHolding(db, needle), [], `表里还有「${needle}」`);
    }
    assert.equal(ftsHits(db, '是只橘猫'), 0);
    assert.equal(ftsHits(db, 'Seesaw'), 0);
    assert.ok(tablesHolding(db, '住在杭州').includes('memory_doc_lines'));
    assert.equal(ftsHits(db, '住在杭州'), 1);
  } finally {
    db.close();
  }
  const file = readFileSync(t.path);
  for (const needle of ['小周', '是只橘猫', 'Seesaw']) {
    assert.equal(file.includes(Buffer.from(needle, 'utf8')), false, `库文件里还有「${needle}」的字节`);
  }
});
