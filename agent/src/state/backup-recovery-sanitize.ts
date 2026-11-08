// 只处理新建的离线恢复目录。旧确认留在历史里，不成为新库里的登录或执行授权。
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BackupObjectKind } from '../../shared/api/backups.ts';
import type { ObjectType } from '../../shared/state.ts';
import type { Database } from './db.ts';
import { backupObjectAccess } from './backup-objects.ts';
import { BACKUP_TABLES, sha256 } from './backup-files.ts';
import { recordVersion } from './versions.ts';
export function sanitizeRecoveredDatabase(db: Database, current: Database, directory: string, at: string) {
  const later: { kind: BackupObjectKind; id: string; currentVersion: number; backupVersion: number | null }[] = [];
  for (const [kind, table] of Object.entries(BACKUP_TABLES)) {
    for (const row of current.all(`SELECT id, version FROM ${table}`)) {
      const old = db.get(`SELECT version FROM ${table} WHERE id = $id`, { id: String(row['id']) });
      if (old === undefined || Number(row['version']) > Number(old['version'])) {
        later.push({
          kind: kind as BackupObjectKind,
          id: String(row['id']),
          currentVersion: Number(row['version']),
          backupVersion: old === undefined ? null : Number(old['version']),
        });
      }
    }
  }
  db.transaction(() => {
    // 所有旧会话、节点凭证、配对码、推送凭据失效；值不在日志或恢复报告中出现。
    for (const table of ['devices', 'device_keys', 'sessions', 'nodes', 'push_subscriptions']) {
      db.run(`UPDATE ${table} SET revoked_at = $at`, { at });
    }
    for (const [table, column] of [
      ['sessions', 'token_hash'],
      ['nodes', 'credential_hash'],
      ['pairing_codes', 'code_hash'],
      ['node_pairing_codes', 'code_hash'],
    ] as const) {
      for (const row of db.all(`SELECT id FROM ${table}`)) {
        db.run(`UPDATE ${table} SET ${column} = $hash WHERE id = $id`, {
          hash: sha256(randomUUID()),
          id: String(row['id']),
        });
      }
    }
    for (const table of ['pairing_codes', 'node_pairing_codes', 'sessions']) {
      db.run(`UPDATE ${table} SET expires_at = $at`, { at });
    }
    db.run("UPDATE push_subscriptions SET endpoint = 'https://invalid.local/' || id, p256dh = '', auth = ''");
    db.run("UPDATE api_requests SET body = '{}', expires_at = $at", { at });
    db.run('UPDATE nodes SET limits = NULL, confirmed_by_device_id = NULL, confirmed_by_device_at = NULL');
    db.run('UPDATE tool_groups SET enabled = 0, confirmed_by_device_id = NULL, confirmed_by_device_at = NULL');
    db.run(
      "UPDATE agreements SET state = CASE WHEN state = 'revoked' THEN state ELSE 'under_review' END, " +
        'effective_at = NULL, confirmed_by_device_id = NULL, confirmed_by_device_at = NULL',
    );
    db.run("UPDATE asks SET status = 'withdrawn' WHERE status = 'open'");
    // 2026-11-05 起是线：恢复出来的线一律停下（status idle），不在新库里自己接着跑。
    db.run("UPDATE lines SET status = 'idle', paused_until = NULL WHERE status IN ('running', 'waiting', 'paused')");
    db.run("UPDATE line_queue SET status = 'withdrawn' WHERE status = 'queued'");
    db.run("UPDATE inbox_replies SET status = 'unknown' WHERE status IN ('stored', 'sending')");
    db.run("UPDATE feed_sources SET level = 'off'");
    db.run("UPDATE receipts SET status = 'unknown' WHERE status = 'issued'");
    db.run("UPDATE node_actions SET status = 'unknown' WHERE status IN ('queued', 'sent', 'running')");
    db.run(
      "UPDATE money_drafts SET metadata = json_set(metadata, '$.status', 'rejected') " +
        "WHERE json_extract(metadata, '$.status') IN ('reading', 'ready', 'failed')",
    );
    db.run(
      "UPDATE restore_previews SET metadata = json_set(metadata, '$.status', 'rejected') " +
        "WHERE json_extract(metadata, '$.status') = 'pending'",
    );
    db.run(
      "UPDATE backups SET metadata = json_set(metadata, '$.status', 'failed', " +
        "'$.error', '历史备份目录未随本次离线恢复导入，请回原目录核对。')",
    );
    db.run(
      "UPDATE attachments SET metadata = json_set(metadata, '$.status', 'failed', " +
        "'$.error', '原件不在库与笔记备份范围内。') WHERE json_extract(metadata, '$.status') = 'ready'",
    );
    // 先应用当前库中的删除 / 撤销 / 失效，再允许人核对恢复副本。新增及较新内容完整保留在 current-state/。
    for (const [table, column, predicate] of [
      ['notes', 'deleted_at', 'deleted_at IS NOT NULL'],
      ['memory_entries', 'deleted_at', 'deleted_at IS NOT NULL'],
      ['money_entries', 'deleted_at', 'deleted_at IS NOT NULL'],
      ['money_accounts', 'archived_at', 'archived_at IS NOT NULL'],
      ['inbox_messages', 'archived_at', 'archived_at IS NOT NULL'],
      ['notes', 'private', 'private = 1'],
      ['notes', 'read_only', 'read_only = 1'],
      ['memory_entries', 'stale', 'stale = 1'],
      ['agreements', 'state', "state = 'revoked'"],
    ]) {
      for (const row of current.all(`SELECT id, ${column} AS value FROM ${table} WHERE ${predicate}`)) {
        db.run(`UPDATE ${table} SET ${column} = $value WHERE id = $id`, {
          id: String(row['id']),
          value: row['value'] ?? null,
        });
      }
    }
    const access = backupObjectAccess({ db, now: () => at, newId: randomUUID }, join(directory, 'notes'));
    for (const kind of ['agreement', 'memory_entry'] as const) {
      const table = BACKUP_TABLES[kind];
      db.run(`UPDATE ${table} SET version = version + 1, updated_at = $at`, { at });
      for (const row of db.all(`SELECT id FROM ${table}`)) {
        const value = access.read(kind, String(row['id']));
        if (value === null) {
          continue;
        }
        recordVersion(db, {
          objectType: kind as ObjectType,
          objectId: String(row['id']),
          version: Number(value['version']),
          snapshot: value,
          fields: ['offlineRecovery'],
          confirmation: undefined,
          migratedDefault: false,
          createdAt: at,
          change: { actor: 'system', reason: '离线恢复：保留历史，失效旧授权并应用当前删除记录' },
        });
      }
    }
  });
  return later;
}
