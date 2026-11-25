import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { BUSY_TIMEOUT_MS, MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { StateError } from '../../src/state/errors.ts';
import { tempDirectory, throwsState } from './helpers.ts';

let directory = '';
let cleanup: () => Promise<void> = async () => undefined;
const opened: Database[] = [];

function open(path = join(directory, 'plasticine.sqlite')): Database {
  const db = openDatabase(path);
  opened.push(db);
  return db;
}

beforeEach(async () => {
  ({ directory, cleanup } = await tempDirectory());
});

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
  }
  await cleanup();
});

test('Opening DB enables WAL mode, foreign keys, and busy timeout', () => {
  const db = open();
  assert.equal(db.get('PRAGMA journal_mode')?.['journal_mode'], 'wal');
  assert.equal(db.get('PRAGMA foreign_keys')?.['foreign_keys'], 1);
  assert.equal(db.get('PRAGMA busy_timeout')?.['timeout'], BUSY_TIMEOUT_MS);
});

test('Opening same DB file twice in one process fails; succeeds after closing', () => {
  const first = openDatabase(join(directory, 'plasticine.sqlite'));
  throwsState(() => open(), 'writer_already_open');
  first.close();
  open();
});

test('Multiple in-memory DBs open simultaneously without interfering', () => {
  const a = open(MEMORY_DATABASE);
  const b = open(MEMORY_DATABASE);
  a.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
  assert.equal(b.get("SELECT count(*) AS n FROM sqlite_master WHERE name = 't'")?.['n'], 0);
});

test('Throwing inside transaction rolls back entire block and rethrows error', () => {
  const db = open();
  db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
  assert.throws(
    () =>
      db.transaction(() => {
        db.run("INSERT INTO t (id) VALUES ('a')");
        throw new Error('中途出错');
      }),
    /中途出错/,
  );
  assert.equal(db.get('SELECT count(*) AS n FROM t')?.['n'], 0);
});

test('Failed nested transaction rolls back inner savepoint while outer commits', () => {
  const db = open();
  db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
  db.transaction(() => {
    db.run("INSERT INTO t (id) VALUES ('outer')");
    assert.throws(() =>
      db.transaction(() => {
        db.run("INSERT INTO t (id) VALUES ('inner')");
        throw new Error('里面失败');
      }),
    );
  });
  assert.deepEqual(
    db.all('SELECT id FROM t').map((row) => row['id']),
    ['outer'],
  );
});

test('Passing an async function to transaction rejects and rolls back', async () => {
  const db = open();
  db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
  let pending: Promise<void> | undefined;
  const error = throwsState(
    () =>
      db.transaction(() => {
        db.run("INSERT INTO t (id) VALUES ('a')");
        pending = Promise.resolve();
        return pending;
      }),
    'not_synchronous',
  );
  assert.ok(error instanceof StateError);
  await pending;
  assert.equal(db.get('SELECT count(*) AS n FROM t')?.['n'], 0);
});

test('Deferred foreign key failure on COMMIT rolls back cleanly for later txns', () => {
  const db = open();
  db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
  db.exec(`CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)`);
  assert.throws(() => db.transaction(() => db.run('INSERT INTO child VALUES (1)')), /FOREIGN KEY/);
  assert.equal(db.get('SELECT count(*) AS n FROM child')?.['n'], 0);
  db.transaction(() => {
    db.run('INSERT INTO parent VALUES (1)');
    db.run('INSERT INTO child VALUES (1)');
  });
  assert.equal(db.get('SELECT count(*) AS n FROM child')?.['n'], 1);
});

test('Async transaction callback rejects before running without writing to DB', async () => {
  const db = open();
  db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
  let entered = false;
  throwsState(() => db.transaction(async () => {
    entered = true;
    db.run("INSERT INTO t VALUES ('before')");
    await Promise.resolve();
    db.run("INSERT INTO t VALUES ('after')");
  }), 'not_synchronous');
  await Promise.resolve();
  assert.equal(entered, false);
  assert.equal(db.get('SELECT count(*) AS n FROM t')?.['n'], 0);
});

test('Erasing zeroes deleted bytes and previously freed pages while keeping other data', () => {
  const path = join(directory, 'plasticine.sqlite');
  const db = open(path);
  db.exec('CREATE TABLE notes_kept (body TEXT)');
  db.run('INSERT INTO notes_kept VALUES ($body)', { body: '住在杭州' });
  db.exec('CREATE TABLE old_stuff (body TEXT)');
  for (let n = 0; n < 40; n += 1) {
    db.run('INSERT INTO old_stuff VALUES ($body)', { body: `小周的猫叫年糕 ${'。'.repeat(400)}${n}` });
  }
  db.exec('DROP TABLE old_stuff');
  db.exec('CREATE TABLE to_forget (body TEXT)');
  db.run('INSERT INTO to_forget VALUES ($body)', { body: '常去的咖啡店是 Seesaw' });
  assert.ok(Number(db.get('PRAGMA freelist_count')?.['freelist_count']) > 0);
  db.erasing(() => db.run('DELETE FROM to_forget'));
  assert.deepEqual(db.all("SELECT name FROM sqlite_schema WHERE name = 'erase_scrub'"), []);
  assert.equal(db.get('SELECT body FROM notes_kept')?.['body'], '住在杭州');
  assert.equal(db.get('PRAGMA integrity_check')?.['integrity_check'], 'ok');
  opened.splice(opened.indexOf(db), 1);
  db.close();
  const file = readFileSync(path);
  for (const needle of ['小周的猫', 'Seesaw']) {
    assert.equal(file.includes(Buffer.from(needle, 'utf8')), false, `库文件里还有「${needle}」`);
  }
  assert.equal(file.includes(Buffer.from('住在杭州', 'utf8')), true);
});
