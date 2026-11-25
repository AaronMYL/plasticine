import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openState, type StateService } from '../../src/state/index.ts';
import {
  applyPendingMigration, MigrationProblem, MigrationService, readPending,
} from '../../src/system/migration/index.ts';
import { MIGRATION_CHUNK_BYTES, type MigrationStatus } from '../../shared/api/migration.ts';

const NOW = new Date('2026-11-16T08:00:00.000Z');
const now = (): Date => NOW;

async function until(read: () => boolean, label: string): Promise<void> {
  for (let tries = 0; tries < 400; tries += 1) {
    if (read()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`等不到：${label}`);
}

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function source(directory: string): StateService {
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  state.notes.create({ markdown: '# 那台的笔记\n内容', author: 'user', folder: '日常' });
  const main = state.lines.main();
  state.lineMessages.append(main.id, 'user', { role: 'user', content: '那台的话' });
  write(join(directory, 'files', '报告.md'), '那台的报告');
  write(join(directory, 'files', '只有那台.md'), '只在那台');
  write(join(directory, 'files', '资料', '一.md'), '那台的资料一');
  write(join(directory, 'files', '资料', '二.md'), '那台的资料二');
  write(join(directory, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: 那台\n---\n');
  write(join(directory, 'credentials', 'mail.json'), '{"token":"fake-source-token"}');
  write(join(directory, 'web-push-vapid.json'), '{"fake":"source"}');
  write(join(directory, 'backups', 'old', 'x.txt'), '备份不带');
  return state;
}

function target(directory: string): void {
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  try {
    state.notes.create({ markdown: '# 这台的笔记\n内容', author: 'user', folder: '日常' });
    state.lineMessages.append(state.lines.main().id, 'user', { role: 'user', content: '这台的话' });
  } finally {
    state.close();
  }
  const db = new DatabaseSync(join(directory, 'plasticine.sqlite'));
  db.prepare(`INSERT INTO kernel_credentials (provider_id, type, credential, updated_at)
    VALUES ('here', 'api', '{}', ?)`).run(NOW.toISOString());
  db.close();
  write(join(directory, 'files', '报告.md'), '这台的报告');
  write(join(directory, 'credentials', 'here.json'), '{"token":"fake-target-token"}');
}

async function exportFrom(service: MigrationService, requestId: string, mode: 'data' | 'full',
  passphrase: string | null): Promise<string> {
  service.startExport(requestId, mode, passphrase);
  await until(() => service.status().export?.state !== 'running', '导出打包完');
  assert.equal(service.status().export?.state, 'ready', service.status().export?.error ?? '');
  const file = service.exportFile();
  assert.ok(file !== null);
  return file.path;
}

async function upload(service: MigrationService, requestId: string, path: string): Promise<MigrationStatus> {
  const bytes = readFileSync(path);
  service.startImport(requestId, 'from-there.plasticine', bytes.length);
  for (let offset = 0; offset < bytes.length; offset += MIGRATION_CHUNK_BYTES) {
    await service.appendChunk(offset, bytes.subarray(offset, offset + MIGRATION_CHUNK_BYTES));
  }
  return service.completeImport();
}

function noteTitles(directory: string): string[] {
  const db = new DatabaseSync(join(directory, 'plasticine.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT title FROM notes ORDER BY title').all().map((row) => String(row['title']));
  } finally {
    db.close();
  }
}

function providers(directory: string): string[] {
  const db = new DatabaseSync(join(directory, 'plasticine.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT provider_id FROM kernel_credentials').all().map((row) => String(row['provider_id']));
  } finally {
    db.close();
  }
}

test('Full encrypted export merges and rolls back; data-only replaces and rolls back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-service-'));
  const there = join(root, 'there');
  const here = join(root, 'here');
  mkdirSync(there);
  mkdirSync(here);
  const sourceState = source(there);
  try {
    target(here);
    let restarts = 0;
    const exporter = new MigrationService({ stateDirectory: there, now,
      snapshot: (path) => sourceState.snapshotTo(path), restart: () => undefined, diskFree: () => 1e12 });
    const importer = (): MigrationService => new MigrationService({ stateDirectory: here, now,
      snapshot: () => assert.fail('导入这台不用快照'), restart: () => { restarts += 1; }, diskFree: () => 1e12 });
    assert.throws(() => exporter.startExport('full-no-pass', 'full', null), MigrationProblem);
    const full = await exportFrom(exporter, 'export-full', 'full', 'fake passphrase 1');
    assert.equal(readFileSync(full).includes(Buffer.from('那台的报告')), false);

    const first = importer();
    const locked = await upload(first, 'import-1', full);
    assert.equal(locked.import?.state, 'locked');
    assert.equal(locked.import?.encrypted, true);
    await assert.rejects(first.unlock('not the passphrase'), (error: unknown) =>
      error instanceof MigrationProblem && error.code === 'wrong_passphrase');
    const opened = await first.unlock('fake passphrase 1');
    assert.equal(opened.import?.summary?.counts.notes, 1);
    assert.equal(opened.import?.summary?.counts.files, 4);
    await until(() => first.status().import?.state === 'staged', '解开');
    assert.deepEqual(first.apply('merge').restarting, true);
    assert.equal(restarts, 1);
    assert.equal(readPending(here)?.kind, 'merge');

    const merged = applyPendingMigration(here, now);
    assert.equal(merged?.kind, 'merge');
    assert.equal(merged?.added?.notes, 1);
    assert.equal(merged?.added?.files, 4);
    assert.deepEqual(noteTitles(here), ['这台的笔记', '那台的笔记']);
    assert.equal(readFileSync(join(here, 'files', '报告.md'), 'utf8'), '这台的报告');
    assert.equal(readFileSync(join(here, 'files', '报告（另一台）.md'), 'utf8'), '那台的报告');
    assert.equal(existsSync(join(here, 'skills', 'demo', 'SKILL.md')), true);
    assert.equal(existsSync(join(here, 'credentials', 'mail.json')), false);
    assert.deepEqual(providers(here), ['here']);
    assert.equal(existsSync(join(here, 'backups')), false);
    openState({ path: join(here, 'plasticine.sqlite') }).close();

    const second = importer();
    assert.equal(second.status().before?.how, 'merge');
    assert.equal(second.status().result?.kind, 'merge');
    assert.equal(second.undo().restarting, true);
    applyPendingMigration(here, now);
    assert.deepEqual(noteTitles(here), ['这台的笔记']);
    assert.equal(existsSync(join(here, 'files', '报告（另一台）.md')), false);
    assert.equal(existsSync(join(here, 'files', '只有那台.md')), false);
    assert.equal(existsSync(join(here, 'files', '资料')), false);
    assert.equal(existsSync(join(here, 'skills', 'demo')), false);

    const data = await exportFrom(exporter, 'export-data', 'data', null);
    assert.equal(readFileSync(data).includes(Buffer.from('fake-source-token')), false);
    const third = importer();
    const plain = await upload(third, 'import-2', data);
    assert.equal(plain.import?.encrypted, false);
    await until(() => third.status().import?.state === 'staged', '解开');
    third.apply('replace');
    const replaced = applyPendingMigration(here, now);
    assert.equal(replaced?.kind, 'replace');
    assert.deepEqual(noteTitles(here), ['那台的笔记']);
    assert.equal(readFileSync(join(here, 'files', '报告.md'), 'utf8'), '那台的报告');
    assert.deepEqual(providers(here), ['here']);
    assert.equal(readFileSync(join(here, 'credentials', 'here.json'), 'utf8'), '{"token":"fake-target-token"}');
    openState({ path: join(here, 'plasticine.sqlite') }).close();

    importer().undo();
    applyPendingMigration(here, now);
    assert.deepEqual(noteTitles(here), ['这台的笔记']);
    assert.equal(readFileSync(join(here, 'files', '报告.md'), 'utf8'), '这台的报告');
    assert.equal(importer().status().before, null);
  } finally {
    sourceState.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Archive exported by newer version prompts to upgrade before unpacking', async () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-service-'));
  const there = join(root, 'there');
  const here = join(root, 'here');
  mkdirSync(there);
  mkdirSync(here);
  const sourceState = source(there);
  try {
    const db = new DatabaseSync(join(there, 'plasticine.sqlite'));
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES ('9999-from-the-future', ?)")
      .run(NOW.toISOString());
    db.close();
    const exporter = new MigrationService({ stateDirectory: there, now,
      snapshot: (path) => sourceState.snapshotTo(path), restart: () => undefined, diskFree: () => 1e12 });
    const data = await exportFrom(exporter, 'export-new', 'data', null);
    const importer = new MigrationService({ stateDirectory: here, now, snapshot: () => undefined,
      restart: () => undefined, diskFree: () => 1e12 });
    const status = await upload(importer, 'import-new', data);
    assert.equal(status.import?.state, 'failed');
    assert.equal(status.import?.errorCode, 'too_new');
    assert.throws(() => importer.apply('merge'), MigrationProblem);
    const tight = new MigrationService({ stateDirectory: here, now, snapshot: () => undefined,
      restart: () => undefined, diskFree: () => 1000 });
    assert.throws(() => tight.startImport('import-big', 'big.plasticine', 10_000), /磁盘不够/);
  } finally {
    sourceState.close();
    rmSync(root, { recursive: true, force: true });
  }
});
