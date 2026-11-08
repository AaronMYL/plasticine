import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openState } from '../../src/state/index.ts';
import { brainChange, device, userSource } from './helpers.ts';
import { proposedAgreementText } from '../../shared/agreement-diff.ts';

test('一致快照含笔记全部版本，逐对象恢复留新版本；篡改、基准变化和删除不越过', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-state-'));
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  const proof = { deviceId: 'device-test', confirmedAt: '2026-10-28T00:00:00Z' };
  try {
    const note = state.notes.create({ markdown: '# 起点\n第一版', author: 'user', folder: '日常' });
    const backup = state.backups.begin('manual-1', 'manual');
    state.backups.complete(backup.id);
    assert.equal(state.backups.require(backup.id).status, 'ready');
    assert.equal(state.backups.verify(backup.id).valid, true);
    const changed = state.notes.save(note.id, note.version, { markdown: '# 后来\n第二版' });
    const plan = state.backups.preview(backup.id, 'preview-1', 'note', note.id);
    assert.equal(plan.baseVersion, changed.version);
    const restored = state.backups.restore(plan.id, plan.digest, proof);
    assert.equal(restored.status, 'restored');
    assert.equal(state.notes.readBody(state.notes.require(note.id)), '# 起点\n第一版');
    assert.equal(state.notes.require(note.id).version, 3);
    assert.equal(state.backups.restore(plan.id, plan.digest, proof).resultVersion, 3);
    const stale = state.backups.preview(backup.id, 'preview-2', 'note', note.id);
    state.notes.save(note.id, 3, { markdown: '新输入' });
    assert.throws(() => state.backups.restore(stale.id, stale.digest, proof), /版本/);
    state.notes.markDeleted(note.id);
    const deleted = state.backups.preview(backup.id, 'preview-3', 'note', note.id);
    assert.ok(deleted.blocked.length > 0);
    assert.throws(() => state.backups.restore(deleted.id, deleted.digest, proof));
    writeFileSync(join(directory, 'backups', backup.id, 'notes', note.bodyFile), 'bad');
    assert.equal(state.backups.verify(backup.id).valid, false);
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('有效约定只写提议，不覆盖现在的约定', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-protected-'));
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  try {
    const agreement = state.agreements.create({ kind: 'collaboration', text: '旧约定', scope: '合作' }, brainChange());
    const backup = state.backups.begin('protected-backup', 'manual');
    state.backups.complete(backup.id);
    state.agreements.update(agreement.id, 1, { text: '当前有效约定' }, brainChange());
    state.agreements.confirm(agreement.id, 2, { state: 'active' }, device(), '用户采纳');
    const term = state.backups.preview(backup.id, 'agreement-preview', 'agreement', agreement.id);
    state.backups.restore(term.id, term.digest, device());
    const current = state.agreements.require(agreement.id);
    assert.equal(current.text, '当前有效约定');
    assert.equal(current.state, 'active');
    assert.equal(proposedAgreementText(current.text, current.proposedDiff ?? ''), '旧约定');
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('缺正文的备份失败，保留期只清本功能登记、过了保留期（7 天 + 每周留 4 周，第 116 条）的目录', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-retention-'));
  let now = '2026-10-01T00:00:00Z';
  const state = openState({ path: join(directory, 'plasticine.sqlite'), now: () => now });
  try {
    const note = state.notes.create({ markdown: '内容', author: 'user', folder: '日常' });
    const old = state.backups.begin('daily-2026-10-01', 'daily');
    state.backups.complete(old.id);
    writeFileSync(join(directory, 'backups', 'unmanaged.txt'), '保留');
    now = '2026-11-01T00:00:00Z';
    state.backups.prune();
    assert.equal(state.backups.require(old.id).status, 'expired');
    assert.equal(existsSync(join(directory, 'backups', old.id)), false);
    assert.equal(existsSync(join(directory, 'backups', 'unmanaged.txt')), true);
    rmSync(join(directory, 'notes', note.bodyFile));
    const missing = state.backups.begin('daily-2026-11-01', 'daily');
    state.backups.complete(missing.id);
    assert.equal(state.backups.require(missing.id).status, 'failed');
    assert.equal(state.backups.begin('daily-2026-11-01', 'daily').id, missing.id);
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('较长的结构化恢复预览仍能解码，截断只影响预览不影响恢复正文', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-long-preview-'));
  const state = openState({ path: join(directory, 'plasticine.sqlite') });
  try {
    const text = '很长的一句原话。'.repeat(3000);
    const entry = state.memory.create({ text, kind: 'quote', basis: 'self_reported', sourceId: userSource(state),
      provenance: '对话' }, brainChange());
    const backup = state.backups.begin('long-preview-backup', 'manual');
    state.backups.complete(backup.id);
    state.memory.update(entry.id, 1, { text: '现在的话' }, brainChange());
    const preview = state.backups.preview(backup.id, 'long-preview', 'memory_entry', entry.id);
    const display = JSON.parse(preview.after) as Record<string, unknown>;
    assert.match(String(display['text']), /内容较长，预览已截断/);
    assert.ok(preview.after.length < text.length);
    state.backups.restore(preview.id, preview.digest, device());
    assert.equal(state.memory.require(entry.id).text, text);
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
