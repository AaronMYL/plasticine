import assert from 'node:assert/strict';
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

test('打开库后是 WAL 模式、外键开、忙等时限生效', () => {
  const db = open();
  assert.equal(db.get('PRAGMA journal_mode')?.['journal_mode'], 'wal');
  assert.equal(db.get('PRAGMA foreign_keys')?.['foreign_keys'], 1);
  assert.equal(db.get('PRAGMA busy_timeout')?.['timeout'], BUSY_TIMEOUT_MS);
});

test('同一进程第二次打开同一个文件被拒绝，关掉后可以再开', () => {
  const first = openDatabase(join(directory, 'plasticine.sqlite'));
  throwsState(() => open(), 'writer_already_open');
  first.close();
  open();
});

test('内存库可以同时开多个，测试互不影响', () => {
  const a = open(MEMORY_DATABASE);
  const b = open(MEMORY_DATABASE);
  a.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
  assert.equal(b.get("SELECT count(*) AS n FROM sqlite_master WHERE name = 't'")?.['n'], 0);
});

test('事务里抛错时整段回滚，错误原样抛出', () => {
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

test('嵌套事务失败只回滚里面那段，外面的照常提交', () => {
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

test('事务里传进异步函数会被拒绝并回滚', async () => {
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

test('COMMIT 的延迟外键约束失败也回滚，之后仍可开新事务', () => {
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

test('异步事务回调在执行前拒绝，await 前后都不会写库', async () => {
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
