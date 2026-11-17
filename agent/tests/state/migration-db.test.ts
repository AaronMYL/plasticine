import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  contentCounts, copyDatabase, handleOf, keepMachineTables, mergeDatabase, MIGRATION_TABLES, openState, schemaOf,
  stripSnapshot, unknownMigrations,
} from '../../src/state/index.ts';
import { FTS_TABLES, SCHEMA_TABLE } from '../../src/state/migration-tables.ts';

const AT = '2026-11-16T08:00:00.000Z';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'migration-db-'));
}

/** 一台的库：主线两句、一篇笔记、一位队友、一个联系人和一条来往、一张开着的卡；再加密钥、设备、身份和一份备份登记。 */
function seed(directory: string, side: 'a' | 'b'): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'plasticine.sqlite');
  const state = openState({ path });
  try {
    const main = state.lines.main();
    state.lineMessages.append(main.id, 'user', { role: 'user', content: `${side} 的第一句` });
    state.lineMessages.append(main.id, 'assistant', { role: 'assistant', content: `${side} 的回答` });
    state.notes.create({ markdown: `# ${side} 的笔记\n正文`, author: 'user', folder: '日常' });
  } finally {
    state.close();
  }
  const db = new DatabaseSync(path);
  try {
    const mateLine = `line-mate-${side}`;
    db.prepare(`INSERT INTO lines (id, created_at, updated_at, kind, title, status) VALUES (?, ?, ?, 'side', ?,
      'running')`).run(mateLine, AT, AT, `${side} 的队友线`);
    db.prepare(`INSERT INTO mates (id, created_at, updated_at, version, name, avatar, hue, role, soul, line_id)
      VALUES (?, ?, ?, 1, '小研', 'a', 'blue', '研究', '认真', ?)`).run(`mate-${side}`, AT, AT, mateLine);
    db.prepare(`INSERT INTO contacts (id, created_at, updated_at, version, account_id, handle, display_name,
      signing_key, encryption_key, state, last_at)
      VALUES (?, ?, ?, 1, 'acct-friend', 'friend', '朋友', 'k', 'k', 'active', ?)`)
      .run(`contact-${side}`, AT, AT, AT);
    db.prepare(`INSERT INTO contact_messages (id, created_at, updated_at, version, contact_id, direction, author, kind,
      text, sent_at, status) VALUES (?, ?, ?, 1, ?, 'in', 'them', 'text', ?, ?, 'received')`)
      .run(`cm-${side}`, AT, AT, `contact-${side}`, `${side} 收到的话`, AT);
    db.prepare(`INSERT INTO asks (id, created_at, updated_at, version, kind, purpose, channel, question, options,
      status) VALUES (?, ?, ?, 1, 'decide', 'cognition', 'popup', '要不要？', '[]', 'open')`).run(`ask-${side}`, AT, AT);
    db.prepare("INSERT INTO kernel_credentials (provider_id, type, credential, updated_at) VALUES (?, 'api', '{}', ?)")
      .run(`provider-${side}`, AT);
    db.prepare(`INSERT INTO devices (id, created_at, updated_at, version, name, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)`).run(`device-${side}`, AT, AT, `${side} 的电脑`, AT, AT);
    db.prepare(`INSERT INTO network_identity (id, created_at, updated_at, version, account_id, handle, display_name,
      relay_url, signing_public_key, signing_private_key, encryption_public_key, encryption_private_key, joined_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, 'https://relay.example.com', 'p', 's', 'p', 's', ?)`)
      .run(`identity-${side}`, AT, AT, `acct-${side}`, `${side}-handle`, side, AT);
    db.prepare("INSERT INTO backups (id, request_id, metadata) VALUES (?, ?, '{}')")
      .run(`backup-${side}`, `req-${side}`);
  } finally {
    db.close();
  }
  return path;
}

function rows(path: string, sql: string, ...params: string[]): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(sql).all(...params).map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

test('库里每张表都归了类（新表要登记），登记的表都还在', () => {
  const directory = scratch();
  try {
    const path = join(directory, 'plasticine.sqlite');
    openState({ path }).close();
    const names = rows(path, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .map((row) => String(row['name']));
    const loose = names.filter((name) => !MIGRATION_TABLES.has(name) && !FTS_TABLES.includes(name)
      && name !== SCHEMA_TABLE);
    assert.deepEqual(loose, []);
    assert.deepEqual([...MIGRATION_TABLES.keys()].filter((name) => !names.includes(name)), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('只要数据的快照：密钥、设备、身份和备份登记都没了，对话和笔记都在；全部的只去掉备份登记', () => {
  const directory = scratch();
  try {
    const path = seed(directory, 'a');
    assert.equal(handleOf(path), 'a-handle');
    const data = join(directory, 'data.sqlite');
    const full = join(directory, 'full.sqlite');
    copyDatabase(path, data);
    copyDatabase(path, full);
    stripSnapshot(data, 'data');
    stripSnapshot(full, 'full');
    for (const table of ['kernel_credentials', 'devices', 'network_identity', 'backups']) {
      assert.equal(rows(data, `SELECT count(*) AS n FROM ${table}`)[0]?.['n'], 0, table);
    }
    assert.equal(rows(full, 'SELECT count(*) AS n FROM kernel_credentials')[0]?.['n'], 1);
    assert.equal(rows(full, 'SELECT count(*) AS n FROM backups')[0]?.['n'], 0);
    assert.deepEqual(contentCounts(data), { lines: 2, memory: 0, notes: 1, books: 0, spaces: 0 });
    assert.deepEqual(schemaOf(data), schemaOf(path));
    assert.deepEqual(unknownMigrations(schemaOf(data)), []);
    assert.deepEqual(unknownMigrations(['9999-from-the-future']), ['9999-from-the-future']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('合并：另一台的主线成了归档的旁聊、不进这台主线；重名队友改名；同一个联系人的来往并到这台那位；卡收回', () => {
  const directory = scratch();
  try {
    const here = seed(join(directory, 'here'), 'a');
    const there = seed(join(directory, 'there'), 'b');
    const outcome = mergeDatabase(here, there, { at: AT, label: '@b-handle' });
    const main = rows(here, "SELECT id FROM lines WHERE kind = 'main'");
    assert.equal(main.length, 1);
    const mainTexts = rows(here, 'SELECT message FROM line_messages WHERE line_id = ?', String(main[0]?.['id']))
      .map((row) => String(row['message']));
    assert.ok(mainTexts.every((text) => !text.includes('b 的')));
    const imported = rows(here, "SELECT id, kind, status, archived_at FROM lines WHERE title = '@b-handle 的主线'");
    assert.equal(imported.length, 1);
    assert.equal(imported[0]?.['kind'], 'side');
    assert.equal(imported[0]?.['archived_at'], AT);
    assert.equal(rows(here, 'SELECT count(*) AS n FROM line_messages WHERE line_id = ?',
      String(imported[0]?.['id']))[0]?.['n'], 2);
    const mateLine = rows(here, "SELECT status, pause_reason FROM lines WHERE id = 'line-mate-b'")[0];
    assert.deepEqual(mateLine, { status: 'paused', pause_reason: 'stopped' });
    assert.deepEqual(rows(here, 'SELECT name FROM mates ORDER BY id').map((row) => row['name']),
      ['小研', '小研（另一台）']);
    assert.deepEqual(rows(here, 'SELECT id FROM contacts').map((row) => row['id']), ['contact-a']);
    assert.deepEqual(rows(here, 'SELECT contact_id FROM contact_messages ORDER BY id').map((row) => row['contact_id']),
      ['contact-a', 'contact-a']);
    assert.deepEqual(rows(here, "SELECT status FROM asks WHERE id = 'ask-b'")[0], { status: 'withdrawn' });
    assert.equal(rows(here, "SELECT count(*) AS n FROM kernel_credentials WHERE provider_id = 'provider-b'")[0]?.['n'],
      0);
    assert.equal(rows(here, "SELECT count(*) AS n FROM devices WHERE id = 'device-b'")[0]?.['n'], 0);
    assert.equal(outcome.added.lines, 2);
    assert.equal(outcome.added.notes, 1);
    assert.ok(outcome.kept >= 1);
    assert.equal(rows(here, 'SELECT count(*) AS n FROM search_sources')[0]?.['n'], 0);
    const reopened = openState({ path: here });
    try {
      assert.ok(reopened.search !== undefined);
    } finally {
      reopened.close();
    }
    assert.ok(Number(rows(here, 'SELECT count(*) AS n FROM search_sources')[0]?.['n']) > 0);
    assert.deepEqual(rows(here, 'PRAGMA foreign_key_check'), []);
    const again = mergeDatabase(here, there, { at: AT, label: '@b-handle' });
    assert.equal(again.added.notes, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('替换：只要数据的那份换进来时，这台的密钥、设备、身份和备份登记留着；全部的那份只留备份登记', () => {
  const directory = scratch();
  try {
    const here = seed(join(directory, 'here'), 'a');
    const there = seed(join(directory, 'there'), 'b');
    const data = join(directory, 'data.sqlite');
    copyDatabase(there, data);
    stripSnapshot(data, 'data');
    keepMachineTables(data, here, 'data');
    assert.deepEqual(rows(data, 'SELECT provider_id FROM kernel_credentials').map((row) => row['provider_id']),
      ['provider-a']);
    assert.deepEqual(rows(data, 'SELECT handle FROM network_identity').map((row) => row['handle']), ['a-handle']);
    assert.deepEqual(rows(data, 'SELECT id FROM backups').map((row) => row['id']), ['backup-a']);
    assert.deepEqual(rows(data, 'SELECT id FROM contacts').map((row) => row['id']), ['contact-b']);
    const full = join(directory, 'full.sqlite');
    copyDatabase(there, full);
    stripSnapshot(full, 'full');
    keepMachineTables(full, here, 'full');
    assert.deepEqual(rows(full, 'SELECT provider_id FROM kernel_credentials').map((row) => row['provider_id']),
      ['provider-b']);
    assert.deepEqual(rows(full, 'SELECT id FROM backups').map((row) => row['id']), ['backup-a']);
    assert.deepEqual(rows(full, 'PRAGMA foreign_key_check'), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('合并：这台库里有老的触发器拦某些行，整批插不进就一行一行插，拦下的那行算留这台的，别的照样并进来', () => {
  const directory = scratch();
  try {
    const here = seed(join(directory, 'here'), 'a');
    const there = seed(join(directory, 'there'), 'b');
    const db = new DatabaseSync(here);
    db.exec(`CREATE TRIGGER old_guard BEFORE INSERT ON notes WHEN NEW.title = 'b 的笔记'
      BEGIN SELECT RAISE(ABORT, 'old trigger says no'); END`);
    db.close();
    const outcome = mergeDatabase(here, there, { at: AT, label: '@b-handle' });
    assert.equal(outcome.added.notes, 0);
    assert.equal(outcome.added.lines, 2);
    assert.deepEqual(rows(here, "SELECT title FROM notes").map((row) => row['title']), ['a 的笔记']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
