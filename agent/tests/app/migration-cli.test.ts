import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openState } from '../../src/state/index.ts';
import { applyPendingMigration, readPending } from '../../src/system/index.ts';

const CLI = join(import.meta.dirname, '../../src/app/migration-cli.ts');

function run(directory: string, args: string[], input = ''): { code: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8',
    env: { ...process.env, PLASTICINE_STATE: directory } });
  return { code: result.status, stderr: result.stderr };
}

test('export all (stdin passphrase) -> import --merge unpacks and merges on target restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-cli-'));
  try {
    const there = join(root, 'there');
    const here = join(root, 'here');
    mkdirSync(there);
    mkdirSync(here);
    const source = openState({ path: join(there, 'plasticine.sqlite') });
    source.notes.create({ markdown: '# 那台的笔记\n内容', author: 'user', folder: '日常' });
    source.close();
    writeFileSync(join(there, 'web-push-vapid.json'), '{"fake":"keys"}');
    openState({ path: join(here, 'plasticine.sqlite') }).close();
    const file = join(root, 'moving.plasticine');
    const short = run(there, ['export', file, '--passphrase-stdin'], 'short\n');
    assert.equal(short.code, 1);
    assert.match(short.stderr, /口令至少 8 位/);
    const exported = run(there, ['export', file, '--passphrase-stdin'], 'fake cli passphrase\n');
    assert.equal(exported.code, 0, exported.stderr);
    assert.match(exported.stderr, /笔记 1 篇/);
    assert.equal(readFileSync(file).includes(Buffer.from('fake')), false);
    assert.equal(run(there, ['export', file, '--passphrase-stdin'], 'fake cli passphrase\n').code, 1);
    assert.equal(run(here, ['import', file]).code, 2);
    const wrong = run(here, ['import', '--merge', file, '--passphrase-stdin'], 'not the passphrase\n');
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /口令不对/);
    const imported = run(here, ['import', '--merge', file, '--passphrase-stdin'], 'fake cli passphrase\n');
    assert.equal(imported.code, 0, imported.stderr);
    assert.equal(readPending(here)?.kind, 'merge');
    assert.equal(applyPendingMigration(here, () => new Date())?.added?.notes, 1);
    assert.equal(existsSync(join(here, 'web-push-vapid.json')), false);
    const data = join(root, 'data.plasticine');
    assert.equal(run(there, ['export', '--data-only', data]).code, 0);
    assert.equal(readFileSync(data).includes(Buffer.from('那台的笔记')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
