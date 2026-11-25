import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoMateCharacter, isMateCharacter, type MateCharacter } from '../../shared/api/mate-characters.ts';
import { openDatabase } from '../../src/state/db.ts';
import { MIGRATIONS } from '../../src/state/migrations/index.ts';
import { openTestState } from './helpers.ts';

const ID = '0134-mate-characters';

test('Migration is registered and non-destructive', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ID);
  assert.ok(entry !== undefined);
  assert.equal(entry.destructive, undefined);
});

test('Replaces avatar text with name-derived role, skips chosen/disabled; main keeps', async () => {
  const fixture = await openTestState();
  try {
    const { state } = fixture;
    const make = (name: string, avatar: MateCharacter, hue: 'sky' | 'rose') => state.mates.create({ name, avatar, hue,
      role: '职责', soul: '', purpose: null,
      lineId: state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: name }).id });
    const old = make('资料研究员', 'cat', 'rose');
    const picked = make('文字编辑', 'bunny', 'sky');
    const gone = make('旧队友', 'cat', 'sky');
    state.mates.update(gone.id, gone.version, { disabledAt: '2026-11-11T00:00:00.000Z' });
    state.kernelSettings.set('main_identity', { name: '阿泥', avatar: '泥', hue: 'sky' });
    fixture.close();

    const db = openDatabase(fixture.path);
    try {
      db.run("UPDATE mates SET avatar = '研' WHERE id = $id", { id: old.id });
      db.run("UPDATE mates SET avatar = '旧' WHERE id = $id", { id: gone.id });
      const migration = MIGRATIONS.find((entry) => entry.id === ID);
      assert.ok(migration !== undefined);
      migration.up(db, { writeNoteBody: () => { throw new Error('不写笔记'); } });
      const row = (id: string) => db.get('SELECT avatar, hue FROM mates WHERE id = $id', { id });
      const first = autoMateCharacter('资料研究员', new Set(['bunny']));
      assert.deepEqual({ ...row(old.id) }, { avatar: first, hue: 'rose' });
      assert.deepEqual({ ...row(picked.id) }, { avatar: 'bunny', hue: 'sky' });
      assert.equal(row(gone.id)?.['avatar'], autoMateCharacter('旧队友', new Set(['bunny', first])));
      assert.notEqual(row(gone.id)?.['avatar'], first);
      assert.ok(isMateCharacter(row(gone.id)?.['avatar']));
      const main = db.get("SELECT value FROM kernel_settings WHERE key = 'main_identity'");
      assert.deepEqual(JSON.parse(String(main?.['value'])), { name: '阿泥' });
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});

test('Does not insert anything when main line name was never saved', async () => {
  const fixture = await openTestState();
  try {
    fixture.close();
    const db = openDatabase(fixture.path);
    try {
      MIGRATIONS.find((entry) => entry.id === ID)?.up(db, { writeNoteBody: () => { throw new Error('不写笔记'); } });
      assert.equal(db.get("SELECT value FROM kernel_settings WHERE key = 'main_identity'"), undefined);
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});
